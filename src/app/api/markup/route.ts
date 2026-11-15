import { NextResponse } from "next/server";
import { parseAmazonImageUrl } from "@/lib/amazon-image";
import { requireUser } from "@/lib/account/guard";
import { bestMatch, marketplaceMatches, markupPercentage, type MarketplaceMatch } from "@/lib/markup/matches";
import { SerpApiError, serpApiSearch } from "@/lib/markup/serpapi";
import { buildTextQuery, productKeywords, textMatches } from "@/lib/markup/text-fallback";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Google Lens via SerpApi typically answers in 3–15s. */
const VISUAL_TIMEOUT_MS = 30_000;
/** The text fallback must keep the whole fallback path under 15s; a Google text search takes 1–4s. */
const TEXT_TIMEOUT_MS = 12_000;
const MAX_TITLE_LENGTH = 500;

// ---------------------------------------------------------------------------
// Response types
// ---------------------------------------------------------------------------

/** Where the match came from: Google Lens image search, the title-keyword fallback, or nothing. */
export type MatchType = "visual" | "text_fallback" | "none";

type ErrorCode =
  | "INVALID_JSON"
  | "INVALID_IMAGE_URL"
  | "INVALID_PRICE"
  | "INVALID_TITLE"
  | "AUTH_REQUIRED"
  | "SERVER_MISCONFIGURED"
  | "SEARCH_FAILED";

type PublicMatch = Pick<MarketplaceMatch, "title" | "link" | "source" | "domain" | "price" | "currency" | "thumbnail">;

export type MarkupResponse =
  | {
      ok: true;
      matchFound: true;
      matchType: Exclude<MatchType, "none">;
      /**
       * visual: cheapest Lens match with a known price, else the most similar unpriced match (price null).
       * text_fallback: highest-ranked relevant, priced AliExpress/Temu listing for the title keywords
       * (a *similar* product, not a verified identical one).
       */
      cheapestMatch: PublicMatch;
      /** null → found on a marketplace, but no usable price, so the markup is unknown (visual only). */
      markupPercentage: number | null;
      amazonPrice: number;
      /** Marketplace matches found by the search that produced this result, and how many had a usable price. */
      matchesConsidered: number;
      pricedMatches: number;
      /** The Google query used for the text fallback, or null if it didn't run. */
      textSearchQuery: string | null;
    }
  | {
      ok: true;
      matchFound: false;
      matchType: "none";
      /**
       * no_marketplace_match → neither image nor title search found an AliExpress/Temu/Alibaba listing.
       * no_cheaper_match     → found with a known price, but not cheaper than Amazon.
       * text_search_failed   → image search found nothing and the title search errored, so it's unverified.
       */
      reason: "no_marketplace_match" | "no_cheaper_match" | "text_search_failed";
      /** true only when BOTH searches ran and found zero marketplace listings → pass to /api/analyze. */
      noMatchesFound: boolean;
      amazonPrice: number;
      textSearchQuery: string | null;
    }
  | { ok: false; error: { code: ErrorCode; message: string } };

const NO_STORE = { "cache-control": "no-store" };

function respond(body: MarkupResponse, status = 200) {
  return NextResponse.json<MarkupResponse>(body, { status, headers: NO_STORE });
}

function fail(status: number, code: ErrorCode, message: string) {
  return respond({ ok: false, error: { code, message } }, status);
}

function noMatch(
  reason: "no_marketplace_match" | "no_cheaper_match" | "text_search_failed",
  amazonPrice: number,
  textSearchQuery: string | null,
) {
  return respond({
    ok: true,
    matchFound: false,
    matchType: "none",
    reason,
    noMatchesFound: reason === "no_marketplace_match",
    amazonPrice,
    textSearchQuery,
  });
}

function toPublic(m: MarketplaceMatch): PublicMatch {
  const { title, link, source, domain, price, currency, thumbnail } = m;
  return { title, link, source, domain, price, currency, thumbnail };
}

// ---------------------------------------------------------------------------
// POST /api/markup
// body: { "imageUrl": "https://m.media-amazon.com/…jpg", "amazonPrice": 39.99, "title": "Amazon product title" }
// ---------------------------------------------------------------------------

export async function POST(request: Request) {
  // 1. Validate input ---------------------------------------------------------
  let body: Record<string, unknown>;
  try {
    const parsed: unknown = await request.json();
    body = typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>) : {};
  } catch {
    return fail(400, "INVALID_JSON", 'Request body must be JSON like {"imageUrl": "…", "amazonPrice": 39.99, "title": "…"}.');
  }

  // Only spend SerpApi credits on Amazon product images (what /api/scrape returns).
  const imageUrl = parseAmazonImageUrl(body.imageUrl);
  if (!imageUrl) {
    return fail(400, "INVALID_IMAGE_URL", '"imageUrl" must be an https Amazon product image URL.');
  }

  const amazonPrice = typeof body.amazonPrice === "string" ? Number(body.amazonPrice) : body.amazonPrice;
  if (typeof amazonPrice !== "number" || !Number.isFinite(amazonPrice) || amazonPrice <= 0) {
    return fail(400, "INVALID_PRICE", '"amazonPrice" must be a positive number, e.g. 39.99.');
  }

  const title = typeof body.title === "string" ? body.title.replace(/\s+/g, " ").trim() : "";
  if (!title || title.length > MAX_TITLE_LENGTH) {
    return fail(400, "INVALID_TITLE", `"title" must be the Amazon product title (1–${MAX_TITLE_LENGTH} characters).`);
  }

  // Scans require a session (account or anonymous guest); usage is counted in /api/scrape.
  const auth = await requireUser(request);
  if (!auth.ok) return fail(auth.status, auth.code, auth.message);

  const apiKey = process.env.SERPAPI_API_KEY;
  if (!apiKey) {
    console.error("[markup] SERPAPI_API_KEY is not set");
    return fail(500, "SERVER_MISCONFIGURED", "Price comparison is temporarily unavailable. Please try again later.");
  }

  // 2. Visual search: Google Lens on the product image ------------------------
  let visual: MarketplaceMatch[];
  try {
    const result = await serpApiSearch(
      { engine: "google_lens", url: imageUrl.toString(), hl: "en", country: "us" }, // country=us → USD prices
      apiKey,
      VISUAL_TIMEOUT_MS,
    );
    visual = result.kind === "results" ? marketplaceMatches(result.json, amazonPrice) : [];
  } catch (err) {
    console.error(`[markup] visual search failed: ${err instanceof Error ? err.message : String(err)}`);
    const timedOut = err instanceof SerpApiError && err.reason === "timeout";
    return fail(
      500,
      "SEARCH_FAILED",
      timedOut
        ? "The image search took too long. Please try again."
        : "We couldn't run the image search right now. Please try again.",
    );
  }

  const visualBest = bestMatch(visual);
  if (visualBest) {
    const markup = markupPercentage(amazonPrice, visualBest.price);
    // Same product exists on a Chinese marketplace but isn't cheaper there — no markup to report.
    if (markup != null && markup <= 0) return noMatch("no_cheaper_match", amazonPrice, null);

    return respond({
      ok: true,
      matchFound: true,
      matchType: "visual",
      cheapestMatch: toPublic(visualBest),
      markupPercentage: markup,
      amazonPrice,
      matchesConsidered: visual.length,
      pricedMatches: visual.filter((m) => m.price != null).length,
      textSearchQuery: null,
    });
  }

  // 3. Text fallback: zero visual matches (common with AI-altered photos) → search the title keywords
  const keywords = productKeywords(title);
  // A title made only of filler/buzzwords leaves nothing to search for.
  if (keywords.length === 0) return noMatch("no_marketplace_match", amazonPrice, null);
  const textSearchQuery = buildTextQuery(keywords);

  let text: MarketplaceMatch[];
  try {
    const result = await serpApiSearch(
      { engine: "google", q: textSearchQuery, gl: "us", hl: "en", google_domain: "google.com" },
      apiKey,
      TEXT_TIMEOUT_MS,
    );
    text = result.kind === "results" ? textMatches(result.json, keywords, amazonPrice) : [];
  } catch (err) {
    // The image search succeeded, so return what we know instead of failing the whole scan.
    console.error(`[markup] text fallback failed: ${err instanceof Error ? err.message : String(err)}`);
    return noMatch("text_search_failed", amazonPrice, textSearchQuery);
  }

  // Highest-ranked relevant listing: for keyword results, relevance beats "cheapest" (often an accessory).
  const textBest = text[0];
  if (!textBest) return noMatch("no_marketplace_match", amazonPrice, textSearchQuery);

  const textMarkup = markupPercentage(amazonPrice, textBest.price);
  if (textMarkup == null || textMarkup <= 0) return noMatch("no_cheaper_match", amazonPrice, textSearchQuery);

  return respond({
    ok: true,
    matchFound: true,
    matchType: "text_fallback",
    cheapestMatch: toPublic(textBest),
    markupPercentage: textMarkup,
    amazonPrice,
    matchesConsidered: text.length,
    pricedMatches: text.length,
    textSearchQuery,
  });
}

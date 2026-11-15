import { NextResponse } from "next/server";
import { ApifyApiError, ApifyClient } from "apify-client";
import { validateAmazonUrl } from "@/lib/amazon";
import { extractProduct, type ExtractField, type ScrapedProduct } from "@/lib/scrape/extract";
import { resolveShortLink } from "@/lib/scrape/resolve-short-link";
import { requireUser } from "@/lib/account/guard";
import { consumeScan, getAccountStatus } from "@/lib/account/server";
import { FREE_SCAN_LIMIT, type AccountStatus } from "@/lib/account/limits";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Apify runs usually take 20–60s. Raise this on Vercel Pro if you see 504s (Hobby caps at 60s).
export const maxDuration = 120;

const ACTOR_ID = process.env.APIFY_ACTOR_ID || "junglee/amazon-crawler";
/** How long this request waits for the run to finish. */
const WAIT_SECS = 90;
/** Hard cap on the Apify run itself, so a stuck run can't keep billing. */
const RUN_TIMEOUT_SECS = 120;

// ---------------------------------------------------------------------------
// Response helpers
// ---------------------------------------------------------------------------

type ErrorCode =
  | "INVALID_JSON"
  | "MISSING_URL"
  | "INVALID_URL"
  | "AUTH_REQUIRED"
  | "SCAN_LIMIT_REACHED"
  | "SERVER_MISCONFIGURED"
  | "SCRAPER_UNAVAILABLE"
  | "SCRAPE_FAILED"
  | "SCRAPE_TIMEOUT"
  | "PRODUCT_NOT_FOUND"
  | "INCOMPLETE_DATA"
  | "PRODUCT_UNAVAILABLE"
  | "INTERNAL_ERROR";

export type ScrapeResponse =
  /** `account` is the caller's plan + scan count after this scan was counted. */
  | { ok: true; data: ScrapedProduct; account: AccountStatus }
  | { ok: false; error: { code: ErrorCode; message: string; missing?: ExtractField[]; account?: AccountStatus } };

function ok(data: ScrapedProduct, account: AccountStatus) {
  return NextResponse.json<ScrapeResponse>({ ok: true, data, account }, { headers: { "cache-control": "no-store" } });
}

const LIMIT_MESSAGE = `You've used your ${FREE_SCAN_LIMIT} free scans. Sign up and upgrade to continue.`;

function fail(
  status: number,
  code: ErrorCode,
  message: string,
  extra?: { missing?: ExtractField[]; account?: AccountStatus },
) {
  return NextResponse.json<ScrapeResponse>(
    { ok: false, error: { code, message, ...extra } },
    { status, headers: { "cache-control": "no-store" } },
  );
}

// ---------------------------------------------------------------------------
// POST /api/scrape   body: { "url": "https://www.amazon.com/dp/B0…" | "https://a.co/d/…" }
// Requires a Supabase session. One successful scrape = one scan: GUEST accounts get FREE_SCAN_LIMIT,
// then 403 SCAN_LIMIT_REACHED. PRO and JUDGE are unlimited.
// ---------------------------------------------------------------------------

export async function POST(request: Request) {
  // 1. Parse + validate input -------------------------------------------------
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return fail(400, "INVALID_JSON", "Request body must be JSON like {\"url\": \"…\"}.");
  }

  const rawUrl = (body as { url?: unknown } | null)?.url;
  if (typeof rawUrl !== "string" || !rawUrl.trim()) {
    return fail(400, "MISSING_URL", "Provide the product link in the \"url\" field.");
  }

  // Same rules as the frontend — never trust the client.
  const check = validateAmazonUrl(rawUrl);
  if (!check.ok) return fail(400, "INVALID_URL", check.error);

  // 2. Who is scanning, and do they have scans left? (checked BEFORE spending an Apify run)
  const auth = await requireUser(request);
  if (!auth.ok) return fail(auth.status, auth.code, auth.message);

  let account: AccountStatus;
  try {
    account = await getAccountStatus(auth.user);
  } catch (err) {
    console.error(`[scrape] ${err instanceof Error ? err.message : String(err)}`);
    return fail(500, "INTERNAL_ERROR", "We couldn't load your account. Please try again.");
  }
  if (account.scansRemaining === 0) return fail(403, "SCAN_LIMIT_REACHED", LIMIT_MESSAGE, { account });

  const token = process.env.APIFY_API_TOKEN;
  if (!token) {
    console.error("[scrape] APIFY_API_TOKEN is not set");
    return fail(500, "SERVER_MISCONFIGURED", "Scanning is temporarily unavailable. Please try again later.");
  }

  // 3. Resolve a.co short links ----------------------------------------------
  let targetUrl = check.url;
  let expectedAsin: string | null = check.asin;
  if (check.kind === "short") {
    const resolved = await resolveShortLink(check.url);
    if (resolved) {
      targetUrl = resolved.url;
      expectedAsin = resolved.asin;
    }
    // else: pass the raw a.co link through; the actor's crawler follows the redirect itself.
  }

  // 4. Run the Apify actor ----------------------------------------------------
  const client = new ApifyClient({ token });

  try {
    const run = await client.actor(ACTOR_ID).call(
      {
        categoryOrProductUrls: [{ url: targetUrl }],
        maxItemsPerStartUrl: 1,
        scrapeProductDetails: true,
        proxyCountry: "AUTO_SELECT_PROXY_COUNTRY",
        // Keep the run lean: we only need title, price and main image.
        maxProductVariantsAsSeparateResults: 0,
        scrapeProductVariantPrices: false,
        maxOffers: 0,
        scrapeSellers: false,
        useCaptchaSolver: false,
      },
      { waitSecs: WAIT_SECS, timeout: RUN_TIMEOUT_SECS, maxItems: 1 },
    );

    if (run.status === "READY" || run.status === "RUNNING") {
      // We stopped waiting but the run is still going: abort it so it doesn't keep billing.
      void client.run(run.id).abort().catch(() => {});
      return fail(504, "SCRAPE_TIMEOUT", "Amazon took too long to respond. Please try again.");
    }
    if (run.status === "TIMED-OUT") {
      return fail(504, "SCRAPE_TIMEOUT", "Amazon took too long to respond. Please try again.");
    }
    if (run.status !== "SUCCEEDED") {
      console.error(`[scrape] run ${run.id} finished with status ${run.status}`);
      return fail(502, "SCRAPE_FAILED", "We couldn't read that product page. Please try again in a moment.");
    }

    // 4. Read results + extract ----------------------------------------------
    const { items } = await client.dataset(run.defaultDatasetId).listItems({ limit: 5, clean: true });
    const products = (items as Record<string, unknown>[]).filter((it) => it && !it.error);

    const item =
      (expectedAsin && products.find((it) => String(it.asin ?? "").toUpperCase() === expectedAsin)) ||
      products[0];

    if (!item) {
      return fail(404, "PRODUCT_NOT_FOUND", "We couldn't find that product. It may have been removed from Amazon.");
    }

    const extracted = extractProduct(item);
    if (!extracted.ok) {
      const noPrice = extracted.missing.includes("price");
      // The actor reports `inStock: false` ("Currently unavailable.") when Amazon has no offer at all.
      if (noPrice && item.inStock === false) {
        return fail(
          422,
          "PRODUCT_UNAVAILABLE",
          "This product is currently unavailable on Amazon, so there's no price to compare.",
          { missing: extracted.missing },
        );
      }
      return fail(
        422,
        "INCOMPLETE_DATA",
        noPrice
          ? "This product has no listed price right now — it may be out of stock or only sold by third parties."
          : "We found the product but couldn't read all of its details.",
        { missing: extracted.missing },
      );
    }

    // 5. Count the scan only now that the listing was actually read (atomic check + increment).
    const counted = await consumeScan(auth.user.id);
    if (!counted) return fail(403, "SCAN_LIMIT_REACHED", LIMIT_MESSAGE, { account });
    return ok(extracted.product, counted);
  } catch (err) {
    if (err instanceof ApifyApiError) {
      console.error(`[scrape] Apify API error ${err.statusCode} (${err.type}): ${err.message}`);
      // 401/403 bad token, 402 out of credits, 404 actor not found / not rented, 429 rate limited.
      return fail(
        502,
        "SCRAPER_UNAVAILABLE",
        err.statusCode === 429
          ? "We're handling a lot of scans right now. Please try again in a minute."
          : "Our scanning service is unavailable right now. Please try again later.",
      );
    }
    console.error("[scrape] unexpected error", err);
    return fail(500, "INTERNAL_ERROR", "Something went wrong while scanning. Please try again.");
  }
}

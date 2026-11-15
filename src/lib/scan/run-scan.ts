/**
 * Client-side orchestration of the real scan pipeline:
 *   1. POST /api/scrape   → title, price, main image (required — the scan stops if this fails)
 *   2. POST /api/markup   → factory-marketplace match + markup (visual, then text fallback)
 *   3. POST /api/analyze  → AI-photo / title-spam analysis, told whether a source was found
 * Steps 2 and 3 are best-effort: if one fails, the report shows what the other found.
 */
import type { ScrapeResponse } from "@/app/api/scrape/route";
import type { MarkupResponse } from "@/app/api/markup/route";
import type { AnalyzeResponse } from "@/app/api/analyze/route";
import type { ScrapedProduct } from "@/lib/scrape/extract";
import type { AnalysisResult } from "@/lib/analyze/parse";
import type { AccountStatus } from "@/lib/account/limits";

export type MarkupResult = Extract<MarkupResponse, { ok: true }>;

/** One section of the report: its data, or the user-facing reason it's missing. */
export type Section<T> = { ok: true; data: T } | { ok: false; error: string };

export type ScanReport = {
  /** The link the user scanned (normalized amazon.com/dp/… or the raw a.co link). */
  productUrl: string;
  product: ScrapedProduct;
  markup: Section<MarkupResult>;
  analysis: Section<AnalysisResult>;
};

/**
 * The scan can't continue (the listing couldn't be read, no session, or out of free scans).
 * `message` is safe to show; `code` is the route's error code (e.g. SCAN_LIMIT_REACHED, AUTH_REQUIRED).
 */
export class ScanError extends Error {
  constructor(
    message: string,
    readonly code?: string,
  ) {
    super(message);
    this.name = "ScanError";
  }
}

const NETWORK_ERROR = "We couldn't reach TruePrice. Check your connection and try again.";

/**
 * POSTs JSON and returns the route's typed body. Every route answers `{ ok: … }`;
 * anything else (network failure, platform timeout page) becomes a readable `{ ok: false }`.
 * Abort errors are re-thrown so cancelling stays silent.
 */
async function post<T extends { ok: boolean }>(
  path: string,
  body: unknown,
  signal: AbortSignal,
): Promise<T | { ok: false; error: { message: string; code?: string } }> {
  let res: Response;
  try {
    res = await fetch(path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal,
    });
  } catch (err) {
    if (signal.aborted) throw err;
    return { ok: false, error: { message: NETWORK_ERROR } };
  }

  const json: unknown = await res.json().catch(() => null);
  if (typeof json === "object" && json !== null && typeof (json as { ok?: unknown }).ok === "boolean") {
    return json as T;
  }
  return {
    ok: false,
    error: {
      message:
        res.status === 504
          ? "The scan took too long. Please try again."
          : "Something went wrong on our side. Please try again.",
    },
  };
}

export async function runScan(
  productUrl: string,
  hooks: {
    signal: AbortSignal;
    /** Called with the index of the step that is starting (SCAN_STEPS order); `SCAN_STEPS.length` when done. */
    onStep: (index: number) => void;
    /** Called as soon as the listing has been read (and the scan counted) — before the slower checks finish. */
    onProduct?: (product: ScrapedProduct, account: AccountStatus) => void;
  },
): Promise<ScanReport> {
  const { signal, onStep, onProduct } = hooks;

  // 1. Scrape ---------------------------------------------------------------
  onStep(0);
  const scraped = await post<ScrapeResponse>("/api/scrape", { url: productUrl }, signal);
  if (!scraped.ok) throw new ScanError(scraped.error.message, scraped.error.code);
  const product = scraped.data;
  onProduct?.(product, scraped.account);

  // 2. Factory-marketplace search ---------------------------------------------
  onStep(1);
  const markupRes = await post<MarkupResponse>(
    "/api/markup",
    { imageUrl: product.imageUrl, amazonPrice: product.price, title: product.title },
    signal,
  );
  const markup: Section<MarkupResult> = markupRes.ok
    ? { ok: true, data: markupRes }
    : { ok: false, error: markupRes.error.message };

  // 3. AI analysis — tell it when neither search found a factory source ----------
  onStep(2);
  const noMatchesFound = markup.ok && !markup.data.matchFound && markup.data.noMatchesFound;
  const analyzeRes = await post<AnalyzeResponse>(
    "/api/analyze",
    { imageUrl: product.imageUrl, title: product.title, noMatchesFound },
    signal,
  );
  const analysis: Section<AnalysisResult> = analyzeRes.ok
    ? { ok: true, data: analyzeRes.data }
    : { ok: false, error: analyzeRes.error.message };

  onStep(3);
  return { productUrl, product, markup, analysis };
}

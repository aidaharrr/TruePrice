import "server-only";

const SERPAPI_ENDPOINT = "https://serpapi.com/search.json";

// SerpApi answers HTTP 200 with this `error` when Google simply has nothing — that's "no results", not a failure.
const NO_RESULTS_RE = /hasn't returned any results|no results/i;

export type SerpApiResult = { kind: "results"; json: Record<string, unknown> } | { kind: "no_results" };

export class SerpApiError extends Error {
  constructor(
    message: string,
    readonly reason: "timeout" | "network" | "api",
    readonly status?: number,
  ) {
    super(message);
    this.name = "SerpApiError";
  }
}

/**
 * One GET to SerpApi. Returns parsed JSON, `no_results`, or throws SerpApiError.
 * The API key is only ever placed in the request URL — never logged or included in error messages.
 */
export async function serpApiSearch(
  params: Record<string, string>,
  apiKey: string,
  timeoutMs: number,
): Promise<SerpApiResult> {
  const query = new URLSearchParams({ ...params, api_key: apiKey });

  let res: Response;
  try {
    res = await fetch(`${SERPAPI_ENDPOINT}?${query}`, { signal: AbortSignal.timeout(timeoutMs), cache: "no-store" });
  } catch (err) {
    const timedOut = err instanceof DOMException && err.name === "TimeoutError";
    throw new SerpApiError(
      timedOut ? `SerpApi ${params.engine} timed out after ${timeoutMs}ms` : `SerpApi ${params.engine} unreachable`,
      timedOut ? "timeout" : "network",
    );
  }

  const json: unknown = await res.json().catch(() => null);
  const body = typeof json === "object" && json !== null ? (json as Record<string, unknown>) : {};
  const apiError = typeof body.error === "string" ? body.error : null;

  if (apiError && NO_RESULTS_RE.test(apiError)) return { kind: "no_results" };
  if (!res.ok || apiError || json === null) {
    throw new SerpApiError(`SerpApi ${params.engine} HTTP ${res.status}: ${apiError ?? "unparseable response"}`, "api", res.status);
  }
  return { kind: "results", json: body };
}

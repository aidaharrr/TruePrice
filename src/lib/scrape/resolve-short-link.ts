import "server-only";
import { validateAmazonUrl } from "@/lib/amazon";

const MAX_HOPS = 5;
const HOP_TIMEOUT_MS = 6000;
// Only ever follow redirects within Amazon's own hosts (prevents SSRF via crafted redirects).
const ALLOWED_HOP_HOST = /^(?:a\.co|(?:www\.|smile\.|m\.)?amazon\.com)$/i;

/**
 * Follows an a.co short link's redirect chain hop-by-hop (without downloading any page body)
 * until it lands on an amazon.com product URL. Returns null if it can't be resolved; the caller
 * then hands the raw a.co link to the scraper, which follows redirects itself.
 */
export async function resolveShortLink(shortUrl: string): Promise<{ asin: string; url: string } | null> {
  let current = shortUrl;

  for (let hop = 0; hop < MAX_HOPS; hop++) {
    let res: Response;
    try {
      res = await fetch(current, {
        method: "GET",
        redirect: "manual",
        signal: AbortSignal.timeout(HOP_TIMEOUT_MS),
        headers: {
          "user-agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36",
          accept: "text/html",
        },
      });
    } catch {
      return null;
    }
    // We only care about the Location header; release the socket without reading the body.
    await res.body?.cancel().catch(() => {});

    const location = res.headers.get("location");
    if (res.status < 300 || res.status >= 400 || !location) return null;

    let next: URL;
    try {
      next = new URL(location, current);
    } catch {
      return null;
    }
    if (!ALLOWED_HOP_HOST.test(next.hostname)) return null;

    const check = validateAmazonUrl(next.href);
    if (check.ok && check.kind === "product") return { asin: check.asin, url: check.url };

    current = next.href;
  }
  return null;
}

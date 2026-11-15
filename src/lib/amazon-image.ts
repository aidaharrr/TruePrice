/**
 * Paid APIs (SerpApi, OpenAI) only accept Amazon product images — what /api/scrape returns —
 * so nobody can burn our credits on arbitrary URLs. Widen this if another source is added.
 */
const AMAZON_IMAGE_HOST = /(^|\.)(media-amazon\.com|ssl-images-amazon\.com|images-amazon\.com)$/i;

/** Returns the parsed URL if it's an https Amazon CDN image, otherwise null. */
export function parseAmazonImageUrl(raw: unknown): URL | null {
  if (typeof raw !== "string") return null;
  try {
    const url = new URL(raw.trim());
    return url.protocol === "https:" && AMAZON_IMAGE_HOST.test(url.hostname) ? url : null;
  } catch {
    return null;
  }
}

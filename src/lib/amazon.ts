/**
 * Frontend validation for Amazon US product URLs.
 *
 * Rules:
 *  - Host must be exactly amazon.com (optionally www., smile. or m.)
 *    → rejects amazon.co.uk, amazon.com.evil.io, evil-amazon.com, amzn.to, etc.
 *  - Protocol http(s) only, no embedded credentials.
 *  - Path must contain a 10-char ASIN (/dp/…, /gp/product/…, /gp/aw/d/…).
 *  - Exception: Amazon's official short links (https://a.co/…) are accepted as-is.
 *    They carry no ASIN, so the raw link is returned and the backend follows the redirect.
 */

/**
 * Real product the "Try instant demo" button scans (Beats Solo 4, Slate Blue). It runs the full live
 * pipeline like any other link. Override with NEXT_PUBLIC_DEMO_PRODUCT_URL (any amazon.com product URL).
 */
export const DEMO_PRODUCT_URL =
  process.env.NEXT_PUBLIC_DEMO_PRODUCT_URL || "https://www.amazon.com/dp/B0CZPHPJLN";

const SHORT_LINK_HOST = "a.co";
const AMAZON_HOST_RE = /^(?:www\.|smile\.|m\.)?amazon\.com$/i;
// Other regional stores (amazon.co.uk, amazon.de, amazon.com.au…) get a friendlier message.
const OTHER_AMAZON_HOST_RE = /^(?:www\.)?amazon\.[a-z]{2,3}(?:\.[a-z]{2})?$/i;
const ASIN_RE = /\/(?:dp|gp\/product|gp\/aw\/d|exec\/obidos\/asin)\/([A-Z0-9]{10})(?:[/?#]|$)/i;

export type AmazonUrlResult =
  /** Full amazon.com product URL; `url` is normalized to https://www.amazon.com/dp/{ASIN}. */
  | { ok: true; kind: "product"; asin: string; url: string }
  /** a.co short link; `url` is the raw link (resolved server-side), ASIN unknown until then. */
  | { ok: true; kind: "short"; asin: null; url: string }
  | { ok: false; error: string };

export function validateAmazonUrl(raw: string): AmazonUrlResult {
  const input = raw.trim();
  if (!input) {
    return { ok: false, error: "Paste an Amazon product link to start a scan." };
  }

  // Let people paste "amazon.com/dp/…" without the protocol.
  const withProtocol = /^[a-z][a-z\d+.-]*:\/\//i.test(input) ? input : `https://${input}`;

  let url: URL;
  try {
    url = new URL(withProtocol);
  } catch {
    return { ok: false, error: "That doesn't look like a valid link. Check for typos and try again." };
  }

  if (url.protocol !== "https:" && url.protocol !== "http:") {
    return { ok: false, error: "Only web links (https://) are supported." };
  }

  if (url.username || url.password) {
    return { ok: false, error: "That link looks unsafe. Copy it directly from Amazon's address bar." };
  }

  if (url.hostname.toLowerCase() === SHORT_LINK_HOST) {
    if (url.pathname.length <= 1) {
      return { ok: false, error: "That short link is incomplete. Copy the full a.co link from Amazon's Share button." };
    }
    return { ok: true, kind: "short", asin: null, url: url.href };
  }

  if (!AMAZON_HOST_RE.test(url.hostname)) {
    if (OTHER_AMAZON_HOST_RE.test(url.hostname)) {
      return { ok: false, error: "We only support amazon.com (US store) right now." };
    }
    return { ok: false, error: "Only amazon.com product links are supported." };
  }

  const match = url.pathname.match(ASIN_RE);
  if (!match) {
    return {
      ok: false,
      error: "That's an Amazon page, but not a product. Open the product and copy its link.",
    };
  }

  const asin = match[1].toUpperCase();
  return { ok: true, kind: "product", asin, url: `https://www.amazon.com/dp/${asin}` };
}

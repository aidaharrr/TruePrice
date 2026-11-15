/**
 * Pure helpers for turning a SerpApi Google Lens response into the cheapest
 * Chinese-marketplace match + markup. Every field is treated as optional.
 */

export type Marketplace = "AliExpress" | "Temu" | "Alibaba";

export type MarketplaceMatch = {
  title: string;
  link: string;
  /** Marketplace brand, derived from the link's hostname. */
  source: Marketplace;
  /** Hostname of the listing, e.g. "www.aliexpress.us". */
  domain: string;
  /** USD price, or null when Lens shows no usable price (missing, unparseable, non-USD or implausible). */
  price: number | null;
  currency: string | null;
  thumbnail: string | null;
};

type Json = Record<string, unknown>;

/**
 * Match on the link's real hostname, not a substring of the whole URL — otherwise
 * "https://scam.shop/?ref=aliexpress" would count.
 * Each pattern accepts the bare domain, ANY subdomain (www., m., pt., share., sale., …) and
 * regional TLDs (.com, .us, .ru, .to, .co.uk, .com.br …), but not look-alikes such as
 * "evilaliexpress.com" or "temu.com.evil.io".
 * Add more here (e.g. 1688.com, dhgate.com) to widen coverage.
 */
const TLD = String.raw`\.[a-z]{2,3}(?:\.[a-z]{2})?$`;
const MARKETPLACES: { re: RegExp; name: Marketplace }[] = [
  { re: new RegExp(String.raw`(^|\.)aliexpress${TLD}`, "i"), name: "AliExpress" },
  { re: new RegExp(String.raw`(^|\.)temu${TLD}`, "i"), name: "Temu" },
  { re: new RegExp(String.raw`(^|\.)alibaba${TLD}`, "i"), name: "Alibaba" },
];

/** SerpApi with country=us returns "$"; anything else can't be compared to an Amazon USD price. */
const USD_CURRENCIES = new Set(["$", "US$", "USD", ""]);

/**
 * Treat prices below this share of the Amazon price as unknown (null). Lens often surfaces $0.01 "coupon"
 * prices or listings for a single spare part, which would produce absurd 10,000%+ markups.
 */
export const MIN_PLAUSIBLE_PRICE_RATIO = 0.03;
export const MIN_PLAUSIBLE_PRICE_USD = 0.5;

const isObj = (v: unknown): v is Json => typeof v === "object" && v !== null && !Array.isArray(v);
const round2 = (n: number) => Math.round(n * 100) / 100;

export function marketplaceFor(link: string): { source: Marketplace; domain: string } | null {
  try {
    const u = new URL(link);
    if (u.protocol !== "https:" && u.protocol !== "http:") return null;
    const hit = MARKETPLACES.find((m) => m.re.test(u.hostname));
    return hit ? { source: hit.name, domain: u.hostname.toLowerCase() } : null;
  } catch {
    return null;
  }
}

/** Prefer SerpApi's numeric `price.extracted_value`; fall back to parsing `price.value` ("$6.80*"). */
export function priceOf(match: Json): { price: number; currency: string } | null {
  const p = match.price;
  if (!isObj(p)) return null;

  const currency = typeof p.currency === "string" ? p.currency.trim() : "";
  if (!USD_CURRENCIES.has(currency.toUpperCase())) return null;

  let value: number | null = null;
  if (typeof p.extracted_value === "number") value = p.extracted_value;
  else if (typeof p.extracted_value === "string") value = Number(p.extracted_value);
  else if (typeof p.value === "string") {
    const m = p.value.replace(/,/g, "").match(/\d+(?:\.\d+)?/);
    value = m ? Number(m[0]) : null;
  }

  if (value == null || !Number.isFinite(value) || value <= 0) return null;
  return { price: round2(value), currency: currency || "$" };
}

/**
 * Steps 1–2: keep every AliExpress / Temu / Alibaba match, in Lens order (most similar first).
 * Matches without a usable price are kept with `price: null` — a sighting on these sites is
 * evidence of dropshipping even when Lens doesn't show what it costs there.
 */
export function marketplaceMatches(serpResponse: unknown, amazonPrice: number): MarketplaceMatch[] {
  const raw = isObj(serpResponse) ? serpResponse.visual_matches : undefined;
  if (!Array.isArray(raw)) return [];

  const minPrice = Math.max(MIN_PLAUSIBLE_PRICE_USD, amazonPrice * MIN_PLAUSIBLE_PRICE_RATIO);
  const out: MarketplaceMatch[] = [];

  for (const m of raw) {
    if (!isObj(m) || typeof m.link !== "string") continue;
    const market = marketplaceFor(m.link);
    if (!market) continue;
    const parsed = priceOf(m);
    const priced = parsed && parsed.price >= minPrice ? parsed : null;

    out.push({
      title: typeof m.title === "string" && m.title.trim() ? m.title.trim() : `${market.source} listing`,
      link: m.link,
      ...market,
      price: priced?.price ?? null,
      currency: priced?.currency ?? null,
      thumbnail: typeof m.thumbnail === "string" ? m.thumbnail : null,
    });
  }
  return out;
}

/**
 * The cheapest match with a known price; if none has a price, the top-ranked (most visually
 * similar) unpriced match. Null only when there are no marketplace matches at all.
 */
export function bestMatch(matches: MarketplaceMatch[]): MarketplaceMatch | null {
  let best: MarketplaceMatch | null = null;
  for (const m of matches) {
    if (m.price != null && (best?.price == null || m.price < best.price)) best = m;
  }
  return best ?? matches[0] ?? null;
}

/** Step 3. Returns null for an unknown, zero, negative or non-finite price (never Infinity/NaN). */
export function markupPercentage(amazonPrice: number, cheapPrice: number | null): number | null {
  if (cheapPrice == null) return null;
  if (!Number.isFinite(amazonPrice) || !Number.isFinite(cheapPrice) || cheapPrice <= 0 || amazonPrice <= 0) {
    return null;
  }
  return Math.round(((amazonPrice - cheapPrice) / cheapPrice) * 100);
}

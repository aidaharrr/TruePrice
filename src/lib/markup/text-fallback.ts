/**
 * Reverse *title* search — used when Google Lens finds no marketplace match for the image
 * (typical for heavily AI-altered photos). Pure helpers: query building + result parsing.
 */
import {
  MIN_PLAUSIBLE_PRICE_RATIO,
  MIN_PLAUSIBLE_PRICE_USD,
  marketplaceFor,
  type MarketplaceMatch,
} from "@/lib/markup/matches";

/** Marketplaces the text query is restricted to. */
export const TEXT_SEARCH_SITES = ["aliexpress.com", "temu.com"] as const;

const MAX_KEYWORDS = 8;

/** Words that describe the listing, audience or packaging rather than the product itself. */
const FILLER = new Set(
  (
    "a an the and or for with without of to in on at by from as is are up into per plus " +
    "new latest upgraded upgrade updated version premium quality high best top hot sale original genuine official " +
    "gift gifts present men women mens womens man woman kids kid boys girls teens adults adult unisex baby " +
    "mom dad mother father birthday christmas valentines holiday " +
    "pack set pcs pc piece pieces count ct bundle kit lot " +
    "compatible compatibility apple android iphone samsung universal " +
    "size color colour black white blue red green pink purple grey gray beige brown navy slate " +
    "hours hour hrs battery life long lasting fast free shipping amazon " +
    "mah inch inches oz lb lbs ft mm cm ml l kg g w v"
  ).split(" "),
);

const ALL_CAPS_BRAND = /^[A-Z][A-Z0-9]{2,}$/;
const YEAR = /^20\d{2}$/;

/**
 * Turns an Amazon title into 3–8 core product keywords.
 *
 *  "LUXEFIT Ergonomic Memory Foam Seat Cushion for Office Chair"   → "ergonomic memory foam seat cushion office chair"
 *  "Beats Solo 4 - Wireless Bluetooth On-Ear Headphones, …"         → "solo wireless bluetooth on-ear headphones"
 *
 * Brand noise: Amazon titles start with the brand. It's dropped when it is ALL-CAPS ("LUXEFIT"), or when the
 * title follows the "Brand Model - descriptors" pattern (short first segment). Otherwise the first word is kept,
 * because unbranded titles like "Seat Cushion for …" start with the product itself.
 */
export function productKeywords(title: string): string[] {
  const cleaned = title
    .replace(/[™®©]/g, "")
    .replace(/\([^)]*\)|\[[^\]]*\]/g, " ") // (2 Pack), [Upgraded 2024]
    .replace(/\s+/g, " ")
    .trim();

  const segments = cleaned
    .split(/\s[-–—|]\s|,|;/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (segments.length === 0) return [];

  const firstWords = segments[0].split(" ");
  const dropBrand =
    ALL_CAPS_BRAND.test(firstWords[0]) || (segments.length > 1 && firstWords.length <= 3 && firstWords.length > 1);
  if (dropBrand) segments[0] = firstWords.slice(1).join(" ");

  const keywords: string[] = [];
  for (const segment of segments) {
    for (const raw of segment.toLowerCase().split(/\s+/)) {
      const word = raw.replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, ""); // trim punctuation, keep inner hyphens ("on-ear")
      if (word.length < 2 || FILLER.has(word) || YEAR.test(word) || /^\d+([.,]\d+)?[a-z]{0,3}$/.test(word)) continue;
      if (!keywords.includes(word)) keywords.push(word);
      if (keywords.length === MAX_KEYWORDS) return keywords;
    }
    // Leading segments describe the product best; stop once we have enough of them.
    if (keywords.length >= 4) break;
  }
  return keywords;
}

export function buildTextQuery(keywords: string[]): string {
  return `${TEXT_SEARCH_SITES.map((s) => `site:${s}`).join(" OR ")} ${keywords.join(" ")}`;
}

// ---------------------------------------------------------------------------
// Result parsing
// ---------------------------------------------------------------------------

type Json = Record<string, unknown>;
const isObj = (v: unknown): v is Json => typeof v === "object" && v !== null && !Array.isArray(v);
const round2 = (n: number) => Math.round(n * 100) / 100;

const USD_PRICE = /(?:US\s?)?\$\s?(\d{1,5}(?:,\d{3})*(?:\.\d{1,2})?)/i;
/** "$" amounts that aren't the item's price: "free shipping on orders over $10", "save $5", "$3 off". */
const NOT_ITEM_PRICE = /(over|orders?|save|saving|off|coupon|shipping|discount|spend|credit)\W*$/i;

function priceFromText(text: unknown): number | null {
  if (typeof text !== "string") return null;
  const re = new RegExp(USD_PRICE.source, "gi");
  for (let m = re.exec(text); m; m = re.exec(text)) {
    const before = text.slice(Math.max(0, m.index - 25), m.index);
    const after = text.slice(m.index + m[0].length, m.index + m[0].length + 6);
    if (NOT_ITEM_PRICE.test(before) || /^\s*off\b/i.test(after)) continue;
    const n = Number(m[1].replace(/,/g, ""));
    if (Number.isFinite(n) && n > 0) return n;
  }
  return null;
}

function priceFromDetected(ext: unknown): number | null {
  if (!isObj(ext)) return null;
  const currency = typeof ext.currency === "string" ? ext.currency.trim().toUpperCase() : "";
  if (currency && !["$", "US$", "USD"].includes(currency)) return null;
  const raw = ext.price ?? ext.extracted_price;
  const n = typeof raw === "number" ? raw : typeof raw === "string" ? Number(raw.replace(/[^0-9.]/g, "")) : NaN;
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** Structured rich-snippet price first, then "$x" in extensions, then "$x" in the snippet/title text. */
function organicPrice(item: Json): number | null {
  const rich = isObj(item.rich_snippet) ? item.rich_snippet : {};
  for (const part of [rich.bottom, rich.top]) {
    if (!isObj(part)) continue;
    const detected = priceFromDetected(part.detected_extensions);
    if (detected != null) return detected;
    if (Array.isArray(part.extensions)) {
      for (const e of part.extensions) {
        const p = priceFromText(e);
        if (p != null) return p;
      }
    }
  }
  return priceFromText(item.snippet) ?? priceFromText(item.title);
}

/**
 * A text hit only counts if it's about the same kind of product: at least half of the
 * keywords (min 2) must appear in its title or snippet.
 */
function isRelevant(item: Json, keywords: string[]): boolean {
  const haystack = `${typeof item.title === "string" ? item.title : ""} ${
    typeof item.snippet === "string" ? item.snippet : ""
  }`.toLowerCase();
  const hits = keywords.filter((k) => haystack.includes(k)).length;
  return hits >= Math.min(2, keywords.length) && hits >= Math.ceil(keywords.length / 2);
}

/**
 * Priced, relevant AliExpress/Temu listings from a SerpApi `google` response, in ranking order.
 * Unlike the visual search, these are *similar* products found by keywords, so a price is required
 * (an unpriced keyword hit says nothing about this listing's markup).
 */
export function textMatches(serpResponse: unknown, keywords: string[], amazonPrice: number): MarketplaceMatch[] {
  if (!isObj(serpResponse)) return [];
  const minPrice = Math.max(MIN_PLAUSIBLE_PRICE_USD, amazonPrice * MIN_PLAUSIBLE_PRICE_RATIO);

  const candidates: { item: Json; price: number | null }[] = [];
  for (const key of ["shopping_results", "inline_shopping_results"]) {
    const arr = serpResponse[key];
    if (!Array.isArray(arr)) continue;
    for (const item of arr) {
      // Shopping results usually link to Google's own product page; only direct marketplace links are usable.
      if (isObj(item)) candidates.push({ item, price: priceFromDetected({ price: item.extracted_price ?? item.price }) });
    }
  }
  if (Array.isArray(serpResponse.organic_results)) {
    for (const item of serpResponse.organic_results) {
      if (isObj(item)) candidates.push({ item, price: organicPrice(item) });
    }
  }

  const out: MarketplaceMatch[] = [];
  for (const { item, price } of candidates) {
    if (typeof item.link !== "string" || price == null || price < minPrice) continue;
    const market = marketplaceFor(item.link);
    if (!market || !isRelevant(item, keywords)) continue;
    if (out.some((m) => m.link === item.link)) continue;
    out.push({
      title: typeof item.title === "string" && item.title.trim() ? item.title.trim() : `${market.source} listing`,
      link: item.link,
      ...market,
      price: round2(price),
      currency: "$",
      thumbnail: typeof item.thumbnail === "string" ? item.thumbnail : null,
    });
  }
  return out;
}

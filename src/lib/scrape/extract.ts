/**
 * Pure helpers that turn a raw Apify Amazon dataset item into the 3 fields we need.
 * Defensive on purpose: actor output shapes drift between versions.
 */

export type ScrapedProduct = {
  title: string;
  /** Current listed price in USD, rounded to cents. */
  price: number;
  /** Largest available main product image (https). */
  imageUrl: string;
};

export type ExtractField = keyof ScrapedProduct;

type Item = Record<string, unknown>;

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Accepts 39.99 | "$1,299.99" | "$10.99 - $15.99" | { value: 39.99, currency: "$" }. */
export function parsePrice(raw: unknown): number | null {
  if (raw == null) return null;
  if (typeof raw === "number") return Number.isFinite(raw) && raw > 0 ? round2(raw) : null;
  if (typeof raw === "string") {
    const m = raw.replace(/,/g, "").match(/\d+(?:\.\d+)?/); // first number = low end of a range
    return m ? parsePrice(Number(m[0])) : null;
  }
  if (typeof raw === "object") {
    const o = raw as Item;
    return parsePrice(o.value ?? o.amount ?? o.price);
  }
  return null;
}

function asHttpsUrl(raw: unknown): string | null {
  if (typeof raw !== "string" || !raw) return null;
  try {
    const u = new URL(raw);
    if (u.protocol !== "https:" && u.protocol !== "http:") return null;
    u.protocol = "https:";
    // Amazon CDN: strip size modifiers ("._AC_SX300_.jpg" → ".jpg") to get the full-resolution image,
    // which reverse image search matches far better than a thumbnail.
    if (/(^|\.)media-amazon\.com$|(^|\.)ssl-images-amazon\.com$/.test(u.hostname)) {
      u.pathname = u.pathname.replace(/\._[^/]*?_\.(jpe?g|png|webp)$/i, ".$1");
    }
    return u.toString();
  } catch {
    return null;
  }
}

function firstString(arr: unknown): unknown {
  return Array.isArray(arr) ? arr.find((x) => typeof x === "string" && x) : undefined;
}

export function pickImage(item: Item): string | null {
  const candidates = [
    firstString(item.highResolutionImages),
    item.mainImage,
    item.thumbnailImage,
    firstString(item.galleryThumbnails),
    firstString(item.images),
    item.image,
  ];
  for (const c of candidates) {
    const url = asHttpsUrl(typeof c === "object" && c ? (c as Item).url : c);
    if (url) return url;
  }
  return null;
}

export function pickTitle(item: Item): string | null {
  const t = item.title ?? item.name;
  if (typeof t !== "string") return null;
  const clean = t.replace(/\s+/g, " ").trim();
  return clean || null;
}

export function extractProduct(
  item: Item,
): { ok: true; product: ScrapedProduct } | { ok: false; missing: ExtractField[] } {
  const title = pickTitle(item);
  const price = parsePrice(item.price);
  const imageUrl = pickImage(item);

  const missing: ExtractField[] = [];
  if (!title) missing.push("title");
  if (price == null) missing.push("price");
  if (!imageUrl) missing.push("imageUrl");

  if (missing.length) return { ok: false, missing };
  return { ok: true, product: { title: title!, price: price!, imageUrl: imageUrl! } };
}

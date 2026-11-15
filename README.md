# TruePrice — Anti-Dropshipping & AI Scanner

Paste an Amazon link and TruePrice runs a live, three-step scan:

1. **`POST /api/scrape`** — reads the listing (title, price, main image) via Apify.
2. **`POST /api/markup`** — finds the factory listing on AliExpress/Temu/Alibaba: Google Lens image search, then a
   title search if the image finds nothing, and computes the markup.
3. **`POST /api/analyze`** — Gemini checks the photo for AI generation and the title for keyword stuffing, and flags
   Ghost Listings (AI photos + no verifiable source).

The browser calls these in order (`src/lib/scan/run-scan.ts`) and renders what they return — there is no mocked
scan data. Steps 2 and 3 are best-effort: if one fails, the report shows the other plus the error.
The Stripe checkout button in the paywall is the one part not yet connected to a real backend.

**Required keys** (`.env.local`, see `.env.example`): `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
`SUPABASE_SERVICE_ROLE_KEY`, `APIFY_API_TOKEN`, `SERPAPI_API_KEY`, `GEMINI_API_KEY`.

## Accounts & scan limits (Supabase)

Every scan belongs to a Supabase user. New visitors get an **anonymous guest session** automatically (no sign-up),
so "3 free scans" is tracked server-side, not in the browser.

| Tier | Scans | How you get it |
| --- | --- | --- |
| `GUEST` | 3 | Anonymous session or a free email account |
| `PRO` | Unlimited | Paid plan (set `tier = 'PRO'` in `profiles` until Stripe is wired) |
| `JUDGE` | Unlimited | `npm run seed:judge` → `judge@trueprice.app` / `hackathon2026` |

- `public.profiles` holds `tier` and `scan_count` (one row per user, created by a trigger on sign-up).
  Users can read only their own row (RLS); only the server's service-role key can write it.
- `/api/scrape` checks the limit **before** starting the paid Apify run, then counts the scan **after** the listing
  was read, via `consume_scan()` — one atomic `UPDATE`, so parallel requests can't exceed the limit. A `GUEST` at the
  limit gets **403 `SCAN_LIMIT_REACHED`** and the app shows "Sign up and upgrade to continue".
- `/api/markup` and `/api/analyze` require a session (401 `AUTH_REQUIRED`) but don't count scans.
- API routes accept the session cookie (browser) or `Authorization: Bearer <access token>` (scripts).

### Setup (about 5 minutes)

1. Create a project at [supabase.com](https://supabase.com/dashboard).
2. **SQL Editor** → paste and run [`supabase/migrations/0001_profiles.sql`](supabase/migrations/0001_profiles.sql).
3. **Authentication → Sign In / Providers**: enable **Allow anonymous sign-ins**. For a hackathon demo, also turn
   off **Confirm email** so new accounts can sign in immediately.
4. **Project Settings → API Keys**: copy the URL, the anon (publishable) key and the service_role (secret) key into
   `.env.local` (see `.env.example`).
5. Create the judge account and restart the dev server:

```bash
npm run seed:judge
```

| File | What it does |
| --- | --- |
| `supabase/migrations/0001_profiles.sql` | `profiles` table, tier enum, RLS, sign-up trigger, `consume_scan()` |
| `src/lib/supabase/*` | Browser, server (cookie/bearer) and service-role clients |
| `src/lib/account/*` | Tiers & limit, `requireUser()` guard, profile read + atomic scan counting |
| `src/middleware.ts` | Refreshes the Supabase session cookie |
| `src/components/account/*` | Account context (guest sessions, status) and the sign-in / sign-up dialog |
| `scripts/seed-judge.mjs` | Creates/resets the judge account with the `JUDGE` tier |

## Setup from scratch

```bash
npx create-next-app@15.5.4 trueprice --ts --tailwind --eslint --app --src-dir --import-alias "@/*" --use-npm --no-turbopack --yes
cd trueprice
npx shadcn@latest init -d
npx shadcn@latest add input card dialog badge progress skeleton separator
npm run dev
```

> The current shadcn CLI defaults to the **Base UI** flavor (`style: "base-nova"`), so composition uses
> `render={<Comp />}` instead of Radix's `asChild`. `lucide-react` is installed by `shadcn init`.

## Where things live

| File | What it does |
| --- | --- |
| `src/app/layout.tsx` | Root layout: font, header, footer, `PaywallProvider` |
| `src/app/page.tsx` | Landing page (hero + scanner, "What we check", "How it works") |
| `src/components/scan/url-scanner.tsx` | URL input, validation errors, demo mode, trial gating, runs the scan |
| `src/components/scan/scan-progress.tsx` | Live 3-step progress; shows the product as soon as it's scraped |
| `src/components/scan/scan-result.tsx` | Report: verdict, markup, AI-photo and title scores, AI summary |
| `src/lib/scan/run-scan.ts` | Client orchestrator: scrape → markup → analyze, typed per-section results |
| `src/lib/scan/verdict.ts` | Derives the headline verdict (Ghost Listing / likely dropshipped / red flags / clear) |
| `src/lib/scan/steps.ts` | Step labels and icons |
| `src/components/paywall-modal.tsx` | `$4.99/mo` paywall dialog + `usePaywall()` context |
| `src/lib/amazon.ts` | `validateAmazonUrl()` — amazon.com-only regex + ASIN extraction |

## Part 2 — Scraping API (`POST /api/scrape`)

Not wired to the UI yet. Uses the Apify actor `junglee/amazon-crawler`.

```bash
npm install apify-client server-only
cp .env.example .env.local   # then paste your token into APIFY_API_TOKEN
```

Get the token from Apify Console → Settings → API & Integrations. On Vercel, add `APIFY_API_TOKEN` under
Project → Settings → Environment Variables. Restart `npm run dev` after editing `.env.local`.

```bash
curl -X POST http://localhost:3000/api/scrape -H "content-type: application/json" -d '{"url":"https://www.amazon.com/dp/B08N5WRWNW"}'
```

| Status | `error.code` | When |
| --- | --- | --- |
| 200 | — | `{ ok: true, data: { title, price, imageUrl } }` |
| 400 | `INVALID_JSON` / `MISSING_URL` / `INVALID_URL` | Bad body or not an amazon.com / a.co link |
| 404 | `PRODUCT_NOT_FOUND` | Actor returned no product |
| 422 | `INCOMPLETE_DATA` | Product found but title / price / image missing (`error.missing` lists which) |
| 422 | `PRODUCT_UNAVAILABLE` | Amazon shows the product as "Currently unavailable" (no price to compare) |
| 500 | `SERVER_MISCONFIGURED` / `INTERNAL_ERROR` | Token not set, or unexpected crash |
| 502 | `SCRAPER_UNAVAILABLE` / `SCRAPE_FAILED` | Apify auth/credits/rate-limit error, or run failed |
| 504 | `SCRAPE_TIMEOUT` | Run didn't finish within 90 s (it's aborted so it stops billing) |

`a.co` short links are resolved server-side first (redirects followed only within a.co/amazon.com); if that
fails, the raw short link is passed to the actor, which follows the redirect itself.

| File | What it does |
| --- | --- |
| `src/app/api/scrape/route.ts` | The route: validation, Apify run, status → HTTP mapping |
| `src/lib/scrape/extract.ts` | Pulls title / price (float) / full-res image out of an actor item |
| `src/lib/scrape/resolve-short-link.ts` | Follows a.co redirects to an amazon.com/dp/ASIN URL |

## Part 3 — Reverse image search & markup (`POST /api/markup`)

Not wired to the UI yet. Uses SerpApi's Google Lens engine via native `fetch` (no SDK).

**Environment variable:** add your SerpApi key to `.env.local` (and to Vercel → Settings → Environment Variables):

```bash
SERPAPI_API_KEY=your_serpapi_key   # https://serpapi.com/manage-api-key
```

Restart `npm run dev` after editing `.env.local`. Each call uses one SerpApi search credit (repeat
searches for the same image within an hour are served from SerpApi's cache for free).

```bash
curl -X POST http://localhost:3000/api/markup -H "content-type: application/json" -d '{"imageUrl":"https://m.media-amazon.com/images/I/71abc.jpg","amazonPrice":39.99,"title":"LUXEFIT Ergonomic Memory Foam Seat Cushion for Office Chair"}'
```

How it decides:

1. Keeps every `visual_matches` entry whose link **hostname** is AliExpress, Temu or Alibaba — any subdomain
   (`pt.aliexpress.com`, `m.temu.com`, `sale.alibaba.com`) and regional TLD (`aliexpress.ru`, `temu.to`) — but not
   look-alikes (`?ref=aliexpress` on another site, `temu.com.evil.io`).
2. Reads a USD price (`price.extracted_value`, falling back to `price.value`). If it's missing, unparseable,
   non-USD or implausibly low (below `max($0.50, 3% of the Amazon price)`), the match is **kept with `price: null`**.
3. Best match = cheapest match with a price; if none has one, the most visually similar match.
   Markup = `Math.round(((amazonPrice - cheapPrice) / cheapPrice) * 100)`, or `null` when the price is unknown.

| Status | Body |
| --- | --- |
| 200 | `{ ok: true, matchFound: true, matchType: "visual" \| "text_fallback", cheapestMatch: { title, link, source, domain, price, currency, thumbnail }, markupPercentage, amazonPrice, matchesConsidered, pricedMatches, textSearchQuery }` |
| 200 | Visual only: `markupPercentage: null` and `cheapestMatch.price: null` → product found on a marketplace, markup unknown |
| 200 | `{ ok: true, matchFound: false, matchType: "none", reason: "no_marketplace_match" \| "no_cheaper_match" \| "text_search_failed", noMatchesFound, amazonPrice, textSearchQuery }` |
| 400 | `INVALID_JSON` / `INVALID_IMAGE_URL` (must be an https Amazon image) / `INVALID_PRICE` / `INVALID_TITLE` |
| 500 | `SERVER_MISCONFIGURED` (key not set) / `SEARCH_FAILED` (SerpApi unreachable, timed out after 30 s, bad key or out of credits) |

| File | What it does |
| --- | --- |
| `src/app/api/markup/route.ts` | The route: validation, SerpApi call, response shaping |
| `src/lib/markup/matches.ts` | Marketplace filtering, price parsing, cheapest pick, markup math |
| `src/lib/markup/text-fallback.ts` | Title → keywords, `site:` query, priced/relevant result parsing |
| `src/lib/markup/serpapi.ts` | Shared SerpApi `fetch` wrapper (timeouts, "no results", typed errors) |

### Part 5 — Text fallback & Ghost Listings

When Google Lens finds **zero** AliExpress/Temu/Alibaba matches (typical for heavily AI-altered photos), `/api/markup`
runs a second, real search instead of stopping:

1. **Keywords:** the Amazon `title` is reduced to 3–8 core product words — brand dropped (ALL-CAPS brands, or the
   "Brand Model - descriptors" pattern), filler removed (audiences, gift words, colors, years, pack sizes, units).
   `"Beats Solo 4 - Wireless Bluetooth On-Ear Headphones, …"` → `solo wireless bluetooth on-ear headphones`.
2. **Search:** SerpApi `google` engine with `site:aliexpress.com OR site:temu.com <keywords>` (12 s timeout, so the
   fallback stays under 15 s).
3. **Parse:** price from the result's rich snippet, else a `$x` in its snippet/title (ignoring "orders over $10",
   "$3 off", …). A result must be on AliExpress/Temu, priced, plausibly priced, and share at least half the keywords.
   Google Shopping results are only used when they link straight to the marketplace.
4. **Result:** the highest-ranked qualifying listing → `matchType: "text_fallback"` with its markup. These are
   *similar* products found by keywords, so a price is required — unlike visual matches.

`matchType` is always `"visual"`, `"text_fallback"` or `"none"`. `noMatchesFound: true` means both searches ran and
found nothing; it is `false` when the text search errored (`reason: "text_search_failed"`), because that's unverified.

Pass `noMatchesFound` to `/api/analyze`. With it, the model weighs AI-image artifacts and dropshipping buzzwords more
heavily, and the response's `ghostListing` is `true` when the photos also look AI-generated — an unverified listing
with no factory source.

## Part 4 — AI vision & title spam analysis (`POST /api/analyze`)

Not wired to the UI yet. One Google Gemini call (`gemini-3.5-flash-lite`, **free tier**, with `gemini-3.7-flash` as backup) looks at the product image
(AI-generation artifacts) and the title (SEO keyword stuffing) and returns strict JSON. It uses the `openai` npm
package pointed at Gemini's OpenAI-compatible endpoint (`https://generativelanguage.googleapis.com/v1beta/openai/`),
so no paid OpenAI account is needed.

```bash
npm install openai
```

**Environment variable:** create a free key at [Google AI Studio](https://aistudio.google.com/app/apikey), add it to
`.env.local` (and Vercel → Settings → Environment Variables), then restart `npm run dev`:

```bash
GEMINI_API_KEY=AIza...             # https://aistudio.google.com/app/apikey
# GEMINI_MODEL=gemini-3.5-flash-lite    # optional override
```

Free-tier quotas are per minute and per day; when they run out the route returns `AI_RATE_LIMITED`. On the free
tier Google may use requests to improve its products — fine here, since titles and images are public listing data.

**PowerShell:**

```powershell
$body = @{
  imageUrl = "https://m.media-amazon.com/images/I/71abc.jpg"
  title    = "Seat Cushion for Office Chair Memory Foam Pillow for Car Wheelchair Gaming Chair Back Pain Relief Gifts for Men Women"
} | ConvertTo-Json
Invoke-RestMethod -Method Post -Uri http://localhost:3000/api/analyze -ContentType "application/json" -Body $body
```

**cURL** (Git Bash / macOS / Linux; in PowerShell use `curl.exe`):

```bash
curl -X POST http://localhost:3000/api/analyze -H "content-type: application/json" -d '{"imageUrl":"https://m.media-amazon.com/images/I/71abc.jpg","title":"Seat Cushion for Office Chair Memory Foam Pillow for Car Gaming Chair Gifts for Men Women","noMatchesFound":true}'
```

| Status | Body |
| --- | --- |
| 200 | `{ ok: true, data: { isAiGenerated, aiConfidenceScore, titleSpamScore, analysisSummary, ghostListing } }` |
| 400 | `INVALID_JSON` / `INVALID_IMAGE_URL` (must be an https Amazon image) / `INVALID_TITLE` (empty or > 500 chars) / `INVALID_NO_MATCHES_FOUND` (not a boolean) |
| 500 | `SERVER_MISCONFIGURED` (`GEMINI_API_KEY` not set) / `AI_TIMEOUT` (every model in the chain took > 15 s) / `AI_RATE_LIMITED` (429 / free-tier quota) / `AI_IMAGE_UNREADABLE` (image download failed or rejected) / `AI_BAD_OUTPUT` (model JSON didn't match the schema) / `AI_UNAVAILABLE` (bad key, outage, Gemini 503 "high demand") |

Notes:
- The model's JSON is validated, not trusted: scores are clamped to 0–100 integers, and `isAiGenerated` is
  derived as `aiConfidenceScore >= 60` so the boolean and the score can't contradict each other.
- The prompt tells the model that white backgrounds, retouching and 3D renders are *not* AI by themselves, and
  to treat the title as data (so a title can't inject instructions).
- The server downloads the Amazon image (≤ 5 MB) and sends it inline as a base64 data URL — the format Gemini's
  compatibility endpoint documents.
- Default model is `gemini-3.5-flash-lite`: on the free tier `gemini-3.8-flash` kept returning 503 or not answering
  within 30 s for image requests, and Google returns 404 for `gemini-2.5-flash` on new API keys.
- No `reasoning_effort` is sent — Gemini's compatibility layer can hang on it alongside an image. The model keeps
  its default thinking, so `max_tokens` is 4096 to leave room for hidden thinking tokens.
- **Model fallback:** if the primary model times out (15 s), returns `503` (free-tier "high demand") or `404` (not
  available to this key), the route immediately tries `GEMINI_FALLBACK_MODELS` in order (default `gemini-3.7-flash`,
  an active Flash model on the key's `/v1beta/models` list). 429 quota and 400 errors don't
  fall back. The model that answered is returned in the `x-ai-model` response header; the JSON body is unchanged.
- Each model gets one attempt (`maxRetries: 0`) of up to 15 s, and all attempts share a 48 s budget so the request
  stays under the 60 s function limit.

| File | What it does |
| --- | --- |
| `src/app/api/analyze/route.ts` | The route: validation, Gemini call + model fallback, Ghost Listing flag, error mapping |
| `src/lib/analyze/prompt.ts` | System prompt + user message builder |
| `src/lib/analyze/parse.ts` | Validates / normalizes the model's JSON into the schema |
| `src/lib/amazon-image.ts` | Shared "is this an Amazon image URL" check (also used by `/api/markup`) |

## Live end-to-end tests (`npm run scan:live`)

`scripts/live-scan.mjs` runs real Amazon products from `scripts/live-products.json` through a running server, calling
the same routes in the same order as the browser, and prints a comparison table. It uses real API credits (one Apify
run, one or two SerpApi searches and one Gemini call per product).

```bash
npm run dev                                         # in another terminal
npm run scan:live                                   # every product in the list
npm run scan:live -- --only canvas-fantasy-desert   # one product
npm run scan:live -- --json live-scan-report.json   # also save full responses (git-ignored)
```

`expect` in the list is a label for reading the results, not an assertion — live listings and prices change. The
script exits with code 1 only if a route returns an error.

Latest run (Nov 2026):

| Product | Expected | Result |
| --- | --- | --- |
| 3-in-1 galaxy projector, $14.99 | dropship | Exact image match on Alibaba at $7.00 → **+114%** |
| Galaxy projector (bedroom & car), $42.98 | dropship | Exact image match on AliExpress, price not shown |
| Posture corrector "NEW 2026" | dropship | Exact image match on Alibaba, price not shown; title 45/100 |
| Blue forest canvas, $162.27 | AI image | AI 85%, no factory source → **Ghost Listing** |
| Fantasy desert canvas, $138.80 | AI image | AI 85% ("melting textures"), no factory source → **Ghost Listing** |
| Bioluminescent forest canvas, $34.99 | AI image | AI 15% — **missed**; title 55/100 |
| Beats Solo 4, $129.00 | genuine | AI 5%, title 15/100, no factory match → no red flags |

Known limits: only the main product image is analyzed (Amazon requires it to be a real photo; AI imagery is more common
in secondary lifestyle images), and Alibaba prices are often wholesale/MOQ prices.

## Demo tips

- **Try instant demo** fills a real product link (Beats Solo 4, `B0CZPHPJLN`) and runs the same live scan as any
  other link (it counts as a scan). Point it at another product with `NEXT_PUBLIC_DEMO_PRODUCT_URL`.
- Judges: sign in as `judge@trueprice.app` / `hackathon2026` for unlimited scans.
- A free scan is only used once the listing has actually been read, so failed scans don't count.
- After 3 scans a guest gets 403 from the server and the paywall opens ("Sign up and upgrade to continue").
- **Go Pro** in the header opens the paywall at any time.

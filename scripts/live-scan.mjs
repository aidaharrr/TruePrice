#!/usr/bin/env node
/**
 * Live end-to-end scan of real Amazon products through a running TruePrice server.
 * Calls the same routes, in the same order, as the browser (src/lib/scan/run-scan.ts):
 *   /api/scrape → /api/markup → /api/analyze (with noMatchesFound from markup)
 *
 * This hits the real Apify, SerpApi and Gemini APIs — every product costs one Apify run,
 * one or two SerpApi searches and one Gemini call.
 *
 * The scan routes require a Supabase session, so the script signs in first — by default as the judge
 * account (unlimited scans; create it with `npm run seed:judge`). Override with
 * TRUEPRICE_TEST_EMAIL / TRUEPRICE_TEST_PASSWORD. Env vars are read from .env.local.
 *
 * Usage:
 *   npm run dev                                   # in another terminal
 *   npm run scan:live                             # all products in scripts/live-products.json
 *   npm run scan:live -- --only beats-solo-4      # one product by id
 *   npm run scan:live -- --base http://localhost:3123 --json report.json
 *
 * `expect` in the product list is a human label for reading the table, not an assertion:
 * live marketplace data changes. The exit code is 1 only if a route returns an error.
 */
import { readFile, writeFile } from "node:fs/promises";
import { createClient } from "@supabase/supabase-js";

const args = process.argv.slice(2);
const arg = (name) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const BASE = (arg("base") ?? process.env.TRUEPRICE_BASE_URL ?? "http://localhost:3000").replace(/\/$/, "");
const ONLY = arg("only");
const JSON_OUT = arg("json");
const LIST = arg("products") ?? new URL("./live-products.json", import.meta.url);

async function signIn() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error("Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY in .env.local.");
  const email = process.env.TRUEPRICE_TEST_EMAIL ?? "judge@trueprice.app";
  const password = process.env.TRUEPRICE_TEST_PASSWORD ?? "hackathon2026";
  const supabase = createClient(url, key, { auth: { persistSession: false } });
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw new Error(`Sign-in as ${email} failed: ${error.message} (did you run "npm run seed:judge"?)`);
  return { email, token: data.session.access_token };
}

let accessToken;

async function post(path, body) {
  const started = Date.now();
  try {
    const res = await fetch(`${BASE}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${accessToken}` },
      body: JSON.stringify(body),
    });
    const json = await res.json().catch(() => ({ ok: false, error: { code: "NON_JSON", message: `HTTP ${res.status}` } }));
    return { ms: Date.now() - started, status: res.status, model: res.headers.get("x-ai-model"), json };
  } catch (err) {
    return { ms: Date.now() - started, status: 0, json: { ok: false, error: { code: "NETWORK", message: String(err) } } };
  }
}

async function scan(product) {
  const steps = {};
  steps.scrape = await post("/api/scrape", { url: product.url });
  if (!steps.scrape.json.ok) return { product, steps };

  const { title, price, imageUrl } = steps.scrape.json.data;
  steps.markup = await post("/api/markup", { imageUrl, amazonPrice: price, title });
  const m = steps.markup.json;
  const noMatchesFound = Boolean(m.ok && !m.matchFound && m.noMatchesFound);
  steps.analyze = await post("/api/analyze", { imageUrl, title, noMatchesFound });
  return { product, steps };
}

const usd = (n) => (n == null ? "?" : `$${n.toFixed(2)}`);
const secs = (ms) => `${(ms / 1000).toFixed(1)}s`;
const clip = (s, n) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

function summarize({ product, steps }) {
  const s = steps.scrape.json;
  if (!s.ok) return { id: product.id, expect: product.expect, error: `scrape: ${s.error.code} ${s.error.message}` };

  const m = steps.markup.json;
  const a = steps.analyze.json;
  const match = !m.ok
    ? `ERROR ${m.error.code}`
    : m.matchFound
      ? `${m.matchType} ${m.markupPercentage == null ? "price?" : `+${m.markupPercentage}%`} ${m.cheapestMatch.source} ${usd(m.cheapestMatch.price)}`
      : `none (${m.reason})`;
  const analysis = !a.ok
    ? `ERROR ${a.error.code}`
    : `AI ${a.data.aiConfidenceScore}% · title ${a.data.titleSpamScore}${a.data.ghostListing ? " · GHOST" : ""}`;

  return {
    id: product.id,
    expect: product.expect,
    title: clip(s.data.title, 60),
    amazon: usd(s.data.price),
    match,
    analysis,
    summary: a.ok ? a.data.analysisSummary : undefined,
    textQuery: m.ok ? m.textSearchQuery : undefined,
    model: steps.analyze.model,
    times: `${secs(steps.scrape.ms)} / ${secs(steps.markup.ms)} / ${secs(steps.analyze.ms)}`,
  };
}

const products = JSON.parse(await readFile(LIST, "utf8")).filter((p) => !ONLY || p.id === ONLY);
if (products.length === 0) {
  console.error(ONLY ? `No product with id "${ONLY}".` : "Product list is empty.");
  process.exit(2);
}

try {
  const session = await signIn();
  accessToken = session.token;
  console.log(`Signed in as ${session.email}`);
} catch (err) {
  console.error(err.message);
  process.exit(2);
}

console.log(`Scanning ${products.length} product(s) against ${BASE}\n`);
const results = [];
for (const product of products) {
  process.stdout.write(`• ${product.id} … `);
  const result = await scan(product);
  const row = summarize(result);
  results.push({ ...result, row });
  console.log(row.error ?? `${row.match} | ${row.analysis} (${row.times})`);
}

console.log("\nResults (times: scrape / markup / analyze)\n");
console.table(
  results.map(({ row }) => ({
    id: row.id,
    expect: row.expect,
    amazon: row.amazon ?? "",
    "factory match": row.match ?? row.error,
    analysis: row.analysis ?? "",
    times: row.times ?? "",
  })),
);
for (const { row } of results) {
  if (row.summary) console.log(`\n[${row.id}] ${row.title}\n  ${row.summary}${row.textQuery ? `\n  text query: ${row.textQuery}` : ""}`);
}

if (JSON_OUT) {
  await writeFile(JSON_OUT, JSON.stringify(results, null, 2));
  console.log(`\nFull responses written to ${JSON_OUT}`);
}

const failed = results.filter(({ steps }) => Object.values(steps).some((step) => step && !step.json.ok));
process.exitCode = failed.length > 0 ? 1 : 0;

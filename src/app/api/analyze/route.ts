import { NextResponse } from "next/server";
import OpenAI, {
  APIConnectionError,
  APIConnectionTimeoutError,
  APIError,
  AuthenticationError,
  BadRequestError,
  PermissionDeniedError,
  RateLimitError,
} from "openai";
import { parseAmazonImageUrl } from "@/lib/amazon-image";
import { requireUser } from "@/lib/account/guard";
import { ANALYZE_SYSTEM_PROMPT, buildUserText } from "@/lib/analyze/prompt";
import { parseAnalysis, type AnalysisResult } from "@/lib/analyze/parse";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Google Gemini (free tier) through its OpenAI-compatible endpoint — same `openai` SDK, different base URL.
const GEMINI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/openai/";
/**
 * Flash-Lite is the primary: on the free tier, gemini-3.8-flash kept returning 503 "high demand" or not
 * answering within 30s for image requests. (gemini-2.5-flash is closed to new API users — 404.)
 */
const PRIMARY_MODEL = process.env.GEMINI_MODEL || "gemini-3.5-flash-lite";
/**
 * Tried in order when the previous model times out, answers 503 (overloaded — common on the free tier)
 * or 404 (not available to this key). Defaults are active Flash models from this key's /v1beta/models list.
 * Override with GEMINI_FALLBACK_MODELS="model-a,model-b" (empty string disables fallback).
 */
const FALLBACK_MODELS = (process.env.GEMINI_FALLBACK_MODELS ?? "gemini-3.7-flash")
  .split(",")
  .map((m) => m.trim())
  .filter((m, i, all) => m && m !== PRIMARY_MODEL && all.indexOf(m) === i);
const MODELS = [PRIMARY_MODEL, ...FALLBACK_MODELS];
const FALLBACK_STATUSES = new Set([503, 404]);

/** Per-model timeout — short, so a stalled model still leaves time for the next one. No SDK retries. */
const AI_TIMEOUT_MS = 15_000;
/** All model attempts together stay under maxDuration (60s) with room for the image download. */
const AI_TOTAL_BUDGET_MS = 48_000;
const MIN_ATTEMPT_MS = 5_000;
const MAX_TITLE_LENGTH = 500; // Amazon caps titles at ~200 chars; anything longer is junk.

// Image download (Gemini's compat endpoint documents base64 data URLs, so we inline the image).
const IMAGE_TIMEOUT_MS = 8_000;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const IMAGE_TYPES = /^image\/(jpeg|png|webp|gif)$/i;

/** Downloads an (already allow-listed) Amazon CDN image and returns it as a data URL, or null. */
async function toDataUrl(url: URL): Promise<string | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(IMAGE_TIMEOUT_MS), redirect: "error" });
    const type = (res.headers.get("content-type") ?? "").split(";")[0].trim();
    if (!res.ok || !IMAGE_TYPES.test(type)) return null;
    if (Number(res.headers.get("content-length") ?? 0) > MAX_IMAGE_BYTES) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.byteLength === 0 || buf.byteLength > MAX_IMAGE_BYTES) return null;
    return `data:${type.toLowerCase()};base64,${buf.toString("base64")}`;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Response types
// ---------------------------------------------------------------------------

type ErrorCode =
  | "INVALID_JSON"
  | "INVALID_IMAGE_URL"
  | "INVALID_TITLE"
  | "INVALID_NO_MATCHES_FOUND"
  | "AUTH_REQUIRED"
  | "SERVER_MISCONFIGURED"
  | "AI_TIMEOUT"
  | "AI_RATE_LIMITED"
  | "AI_IMAGE_UNREADABLE"
  | "AI_BAD_OUTPUT"
  | "AI_UNAVAILABLE";

export type AnalyzeResponse =
  | { ok: true; data: AnalysisResult }
  | { ok: false; error: { code: ErrorCode; message: string } };

const NO_STORE = { "cache-control": "no-store" };

function fail(status: number, code: ErrorCode, message: string) {
  return NextResponse.json<AnalyzeResponse>({ ok: false, error: { code, message } }, { status, headers: NO_STORE });
}

// ---------------------------------------------------------------------------
// POST /api/analyze
// body: { "imageUrl": "https://m.media-amazon.com/…jpg", "title": "…", "noMatchesFound"?: boolean }
// `noMatchesFound` comes from /api/markup: true when image AND title search found no marketplace source.
// ---------------------------------------------------------------------------

export async function POST(request: Request) {
  // 1. Validate input ---------------------------------------------------------
  let body: Record<string, unknown>;
  try {
    const parsed: unknown = await request.json();
    body = typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>) : {};
  } catch {
    return fail(400, "INVALID_JSON", 'Request body must be JSON like {"imageUrl": "…", "title": "…"}.');
  }

  const imageUrl = parseAmazonImageUrl(body.imageUrl);
  if (!imageUrl) {
    return fail(400, "INVALID_IMAGE_URL", '"imageUrl" must be an https Amazon product image URL.');
  }

  const title = typeof body.title === "string" ? body.title.replace(/\s+/g, " ").trim() : "";
  if (!title || title.length > MAX_TITLE_LENGTH) {
    return fail(400, "INVALID_TITLE", `"title" must be a non-empty string of at most ${MAX_TITLE_LENGTH} characters.`);
  }

  if (body.noMatchesFound !== undefined && typeof body.noMatchesFound !== "boolean") {
    return fail(400, "INVALID_NO_MATCHES_FOUND", '"noMatchesFound" must be true or false when provided.');
  }
  const noMatchesFound = body.noMatchesFound === true;

  // Scans require a session (account or anonymous guest); usage is counted in /api/scrape.
  const auth = await requireUser(request);
  if (!auth.ok) return fail(auth.status, auth.code, auth.message);

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.error("[analyze] GEMINI_API_KEY is not set");
    return fail(500, "SERVER_MISCONFIGURED", "Image analysis is temporarily unavailable. Please try again later.");
  }

  // 2. Fetch the image -------------------------------------------------------
  const imageDataUrl = await toDataUrl(imageUrl);
  if (!imageDataUrl) {
    console.error(`[analyze] could not download image ${imageUrl.hostname}${imageUrl.pathname}`);
    return fail(500, "AI_IMAGE_UNREADABLE", "We couldn't load the product image for analysis.");
  }

  // 3. One vision + text call (with model fallback on 503 / 404) -------------
  const ai = new OpenAI({ apiKey, baseURL: GEMINI_BASE_URL, timeout: AI_TIMEOUT_MS, maxRetries: 0 });
  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    { role: "system", content: ANALYZE_SYSTEM_PROMPT },
    {
      role: "user",
      content: [
        { type: "text", text: buildUserText(title, noMatchesFound) },
        { type: "image_url", image_url: { url: imageDataUrl } },
      ],
    },
  ];

  try {
    const startedAt = Date.now();
    let completion: OpenAI.Chat.ChatCompletion | null = null;
    let usedModel = PRIMARY_MODEL;
    let lastError: unknown = null;

    for (const [i, model] of MODELS.entries()) {
      const remaining = AI_TOTAL_BUDGET_MS - (Date.now() - startedAt);
      if (remaining < MIN_ATTEMPT_MS) break;
      try {
        completion = await ai.chat.completions.create(
          {
            model,
            response_format: { type: "json_object" },
            temperature: 0,
            // No reasoning_effort: Gemini's compat layer can hang on it alongside an image. The model's default
            // thinking stays on, and its hidden tokens may count against this limit — leave headroom.
            max_tokens: 4096,
            messages,
          },
          { timeout: Math.min(AI_TIMEOUT_MS, remaining) },
        );
        usedModel = model;
        break;
      } catch (err) {
        lastError = err;
        const timedOut = err instanceof APIConnectionTimeoutError;
        const overloaded = err instanceof APIError && FALLBACK_STATUSES.has(err.status ?? 0);
        if (!(timedOut || overloaded) || i === MODELS.length - 1) throw err;
        const why = timedOut ? `timed out after ${AI_TIMEOUT_MS / 1000}s` : `returned ${(err as APIError).status}`;
        console.warn(`[analyze] ${model} ${why}; falling back to ${MODELS[i + 1]}`);
      }
    }
    if (!completion) throw lastError ?? new Error("No Gemini model attempt fit in the time budget");

    const choice = completion.choices[0];
    const analysis = choice?.finish_reason === "stop" ? parseAnalysis(choice.message.content) : null;
    if (!analysis) {
      console.error(
        `[analyze] unusable output from ${usedModel} (finish_reason=${choice?.finish_reason}, refusal=${!!choice?.message.refusal}):`,
        choice?.message.content?.slice(0, 300),
      );
      return fail(500, "AI_BAD_OUTPUT", "The analysis came back incomplete. Please try again.");
    }

    // Ghost Listing = unverifiable source + AI-looking photos. Derived here, not by the model, so it's deterministic.
    // The label belongs to the flag alone: strip it if the model wrote it anyway, so text and flag can't disagree.
    const data: AnalysisResult = {
      ...analysis,
      analysisSummary: analysis.analysisSummary.replace(/^\s*ghost listing\s*[:\-–—]\s*/i, ""),
      ghostListing: noMatchesFound && analysis.isAiGenerated,
    };

    // Which model answered goes in a header; the JSON body stays the analysis schema.
    return NextResponse.json<AnalyzeResponse>(
      { ok: true, data },
      { headers: { ...NO_STORE, "x-ai-model": usedModel } },
    );
  } catch (err) {
    // Order matters: the timeout error is a subclass of the connection error.
    if (err instanceof APIConnectionTimeoutError) {
      console.error("[analyze] Gemini timed out");
      return fail(500, "AI_TIMEOUT", "The image analysis took too long. Please try again.");
    }
    if (err instanceof RateLimitError) {
      // Free tier: per-minute and per-day quotas ("RESOURCE_EXHAUSTED").
      console.error(`[analyze] Gemini rate limited / quota: ${err.message}`);
      return fail(500, "AI_RATE_LIMITED", "We're handling a lot of scans right now. Please try again in a minute.");
    }
    if (err instanceof BadRequestError && /image|download|url/i.test(err.message)) {
      console.error(`[analyze] Gemini could not read the image: ${err.message}`);
      return fail(500, "AI_IMAGE_UNREADABLE", "We couldn't load the product image for analysis.");
    }
    if (err instanceof AuthenticationError || err instanceof PermissionDeniedError) {
      console.error(`[analyze] Gemini auth error ${err.status}: ${err.message}`);
    } else if (err instanceof APIConnectionError || err instanceof APIError) {
      console.error(`[analyze] Gemini error ${err instanceof APIError ? err.status : "connection"}: ${err.message}`);
    } else {
      console.error("[analyze] unexpected error", err);
    }
    return fail(500, "AI_UNAVAILABLE", "Image analysis is temporarily unavailable. Please try again later.");
  }
}

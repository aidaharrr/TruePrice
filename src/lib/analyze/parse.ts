export type Analysis = {
  isAiGenerated: boolean;
  /** 0–100: how likely the image is AI-generated. */
  aiConfidenceScore: number;
  /** 0–100: how keyword-stuffed the title is. */
  titleSpamScore: number;
  analysisSummary: string;
};

export type AnalysisResult = Analysis & {
  /**
   * High-risk "Ghost Listing": no AliExpress/Temu/Alibaba source was found by image or title search
   * (noMatchesFound) AND the photos look AI-generated — nothing verifiable backs the product.
   */
  ghostListing: boolean;
};

/** Images at or above this AI score are reported as AI-generated (matches the system prompt). */
export const AI_THRESHOLD = 60;

const score = (v: unknown): number | null => {
  const n = typeof v === "string" ? Number(v.trim()) : v;
  if (typeof n !== "number" || !Number.isFinite(n)) return null;
  // Some models answer 0–1 instead of 0–100.
  const scaled = n > 0 && n < 1 ? n * 100 : n;
  return Math.min(100, Math.max(0, Math.round(scaled)));
};

/**
 * Validates the model's JSON against our schema. JSON mode guarantees *valid JSON*, not the
 * right *shape*, so every field is checked. Returns null if anything required is unusable.
 */
export function parseAnalysis(content: string | null | undefined): Analysis | null {
  if (!content) return null;
  let raw: unknown;
  try {
    // Tolerate ```json fences, which some OpenAI-compatible providers add despite JSON mode.
    raw = JSON.parse(content.trim().replace(/^```(?:json)?\s*|\s*```$/gi, ""));
  } catch {
    return null;
  }
  if (typeof raw !== "object" || raw === null) return null;
  const o = raw as Record<string, unknown>;

  const aiConfidenceScore = score(o.aiConfidenceScore);
  const titleSpamScore = score(o.titleSpamScore);
  const summary = typeof o.analysisSummary === "string" ? o.analysisSummary.replace(/\s+/g, " ").trim() : "";
  if (aiConfidenceScore == null || titleSpamScore == null || !summary) return null;

  return {
    // Derived from the score so the boolean and the number can never contradict each other.
    isAiGenerated: aiConfidenceScore >= AI_THRESHOLD,
    aiConfidenceScore,
    titleSpamScore,
    analysisSummary: summary.length > 600 ? `${summary.slice(0, 597)}…` : summary,
  };
}

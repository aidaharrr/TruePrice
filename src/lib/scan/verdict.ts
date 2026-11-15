import type { ScanReport } from "@/lib/scan/run-scan";

export type VerdictLevel = "ghost" | "dropshipped" | "caution" | "clear" | "incomplete";

export type Verdict = {
  level: VerdictLevel;
  headline: string;
};

/** Markups at or above this (on an exact visual match) are called "likely dropshipped". */
export const DROPSHIP_MARKUP_THRESHOLD = 100;
/** Title-spam scores at or above this count as a red flag (the prompt's "heavy stuffing" band starts at 51). */
export const TITLE_SPAM_FLAG = 60;

const usd = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD" });

/**
 * One headline for the whole report, derived only from what the APIs returned.
 * Exact (visual) matches can say "dropshipped"; keyword (text) matches are only "similar items",
 * so they never produce the strongest verdict on their own.
 */
export function verdictFor(report: ScanReport): Verdict {
  const { markup, analysis } = report;

  if (analysis.ok && analysis.data.ghostListing) {
    return { level: "ghost", headline: "Ghost Listing: AI-made photos and no verifiable factory source" };
  }

  if (markup.ok && markup.data.matchFound) {
    const { matchType, markupPercentage, cheapestMatch } = markup.data;
    if (matchType === "visual") {
      if (markupPercentage == null) {
        return { level: "caution", headline: `This product is also listed on ${cheapestMatch.source}` };
      }
      if (markupPercentage >= DROPSHIP_MARKUP_THRESHOLD) {
        return { level: "dropshipped", headline: `Likely dropshipped: ${markupPercentage}% more than on ${cheapestMatch.source}` };
      }
      return { level: "caution", headline: `Sold for ${markupPercentage}% more than on ${cheapestMatch.source}` };
    }
    if (cheapestMatch.price != null) {
      return { level: "caution", headline: `Similar items sell for ${usd(cheapestMatch.price)} on ${cheapestMatch.source}` };
    }
  }

  if (analysis.ok && (analysis.data.isAiGenerated || analysis.data.titleSpamScore >= TITLE_SPAM_FLAG)) {
    const flags = [
      analysis.data.isAiGenerated && "AI-looking photos",
      analysis.data.titleSpamScore >= TITLE_SPAM_FLAG && "a keyword-stuffed title",
    ].filter(Boolean);
    return { level: "caution", headline: `Red flags: ${flags.join(" and ")}` };
  }

  if (!markup.ok && !analysis.ok) {
    return { level: "incomplete", headline: "We couldn't finish the checks for this product" };
  }
  if (!markup.ok || !analysis.ok) {
    return { level: "clear", headline: "No red flags in the checks that completed" };
  }
  return { level: "clear", headline: "No red flags found" };
}

/** Plain-language band for the title-spam score (matches the bands in the system prompt). */
export function titleSpamLabel(score: number): string {
  if (score <= 20) return "Clean title";
  if (score <= 50) return "Some extra keywords";
  if (score <= 80) return "Heavy keyword stuffing";
  return "Extreme keyword stuffing";
}

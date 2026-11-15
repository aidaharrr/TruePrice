"use client";

import Image from "next/image";
import {
  AlertTriangle,
  Bot,
  CircleCheck,
  CircleHelp,
  ExternalLink,
  Ghost,
  RotateCcw,
  Sparkles,
  TextSearch,
  TrendingUp,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { MarkupResult, ScanReport, Section } from "@/lib/scan/run-scan";
import type { AnalysisResult } from "@/lib/analyze/parse";
import { TITLE_SPAM_FLAG, titleSpamLabel, verdictFor, type VerdictLevel } from "@/lib/scan/verdict";

const usd = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD" });

type Tone = "danger" | "warning" | "success" | "neutral";

const VERDICT_STYLE: Record<VerdictLevel, { tone: Tone; icon: LucideIcon }> = {
  ghost: { tone: "danger", icon: Ghost },
  dropshipped: { tone: "danger", icon: AlertTriangle },
  caution: { tone: "warning", icon: AlertTriangle },
  clear: { tone: "success", icon: CircleCheck },
  incomplete: { tone: "neutral", icon: CircleHelp },
};

const TONE_BANNER: Record<Tone, string> = {
  danger: "border-destructive/30 bg-destructive/10 [&_svg]:text-destructive",
  warning: "border-warning/30 bg-warning/10 [&_svg]:text-warning",
  success: "border-success/30 bg-success/10 [&_svg]:text-success",
  neutral: "border-border bg-muted/50 [&_svg]:text-muted-foreground",
};

const TONE_TEXT: Record<Tone, string> = {
  danger: "text-destructive",
  warning: "text-warning",
  success: "text-success",
  neutral: "text-foreground",
};

export function ScanResultCard({
  report,
  onScanAnother,
}: {
  report: ScanReport;
  onScanAnother: () => void;
}) {
  const { product, productUrl, markup, analysis } = report;
  const verdict = verdictFor(report);
  const { tone, icon: VerdictIcon } = VERDICT_STYLE[verdict.level];

  return (
    <Card className="overflow-hidden text-left shadow-lg shadow-primary/5 animate-in fade-in-0 slide-in-from-bottom-2">
      <div className={cn("flex items-center gap-3 border-b px-5 py-3.5 text-sm", TONE_BANNER[tone])} role="status">
        <VerdictIcon className="size-5 shrink-0" />
        <p className="flex-1 font-medium">{verdict.headline}</p>
      </div>

      <CardHeader className="pt-5">
        <div className="flex gap-4">
          <div className="relative size-20 shrink-0 overflow-hidden rounded-xl border bg-white">
            <Image src={product.imageUrl} alt="" fill sizes="80px" className="object-contain p-1" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="line-clamp-2 font-medium leading-snug">{product.title}</p>
            <p className="mt-1 text-sm text-muted-foreground">{usd(product.price)} on Amazon</p>
            <a
              href={productUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-1 inline-flex items-center gap-1 text-xs text-primary hover:underline"
            >
              View on Amazon <ExternalLink className="size-3" />
            </a>
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-5">
        <div className="grid gap-3 sm:grid-cols-3">
          <MarkupTile markup={markup} amazonPrice={product.price} />
          <AiPhotoTile analysis={analysis} />
          <TitleTile analysis={analysis} />
        </div>

        {analysis.ok && (
          <div className="rounded-xl border bg-muted/30 p-4">
            <p className="mb-2 flex items-center gap-2 text-sm font-medium">
              <Sparkles className="size-4 text-primary" /> AI analysis
            </p>
            <p className="text-sm leading-relaxed text-muted-foreground">{analysis.data.analysisSummary}</p>
          </div>
        )}

        <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
          <Button variant="outline" size="lg" className="h-11 gap-2 px-5" onClick={onScanAnother}>
            <RotateCcw className="size-4" /> Scan another product
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Tiles
// ---------------------------------------------------------------------------

function MarkupTile({ markup, amazonPrice }: { markup: Section<MarkupResult>; amazonPrice: number }) {
  if (!markup.ok) {
    return <Tile icon={TrendingUp} label="Factory price" value="Unavailable" tone="neutral" detail={markup.error} />;
  }

  const m = markup.data;
  if (!m.matchFound) {
    const copy = {
      no_marketplace_match: { value: "Not found", detail: "No AliExpress, Temu or Alibaba listing found by image or title search." },
      no_cheaper_match: { value: "Not cheaper", detail: "Found on a factory marketplace, but not for less than on Amazon." },
      text_search_failed: { value: "Unverified", detail: "No image match, and the title search couldn't be completed." },
    }[m.reason];
    return <Tile icon={TrendingUp} label="Factory price" value={copy.value} tone="neutral" detail={copy.detail} />;
  }

  const { cheapestMatch: match, markupPercentage, matchType } = m;
  const listing = (
    <a
      href={match.link}
      target="_blank"
      rel="noopener noreferrer nofollow"
      className="inline-flex items-center gap-1 text-primary hover:underline"
    >
      View on {match.source} <ExternalLink className="size-3" />
    </a>
  );

  return (
    <Tile
      icon={matchType === "visual" ? TrendingUp : TextSearch}
      label={matchType === "visual" ? "Markup · exact image match" : "Markup · similar item"}
      value={markupPercentage == null ? "Price unknown" : `+${markupPercentage}%`}
      tone={markupPercentage == null ? "warning" : markupPercentage >= 100 ? "danger" : "warning"}
      detail={
        <>
          {match.price == null ? (
            <>Same product listed on {match.source}, without a visible price. </>
          ) : (
            <>
              {usd(amazonPrice)} on Amazon vs <strong className="text-foreground">{usd(match.price)}</strong> on{" "}
              {match.source}
              {matchType === "text_fallback" && " (found by title search)"}.{" "}
            </>
          )}
          {listing}
        </>
      }
    />
  );
}

function AiPhotoTile({ analysis }: { analysis: Section<AnalysisResult> }) {
  if (!analysis.ok) {
    return <Tile icon={Bot} label="AI photos" value="Unavailable" tone="neutral" detail={analysis.error} />;
  }
  const { aiConfidenceScore, isAiGenerated } = analysis.data;
  return (
    <Tile
      icon={Bot}
      label="AI photos"
      value={`${aiConfidenceScore}%`}
      tone={isAiGenerated ? "danger" : aiConfidenceScore >= 21 ? "warning" : "success"}
      detail={isAiGenerated ? "likely AI-generated or heavily edited" : "likelihood the main photo is AI-generated"}
    />
  );
}

function TitleTile({ analysis }: { analysis: Section<AnalysisResult> }) {
  if (!analysis.ok) {
    return <Tile icon={TextSearch} label="Title check" value="Unavailable" tone="neutral" detail={analysis.error} />;
  }
  const { titleSpamScore } = analysis.data;
  return (
    <Tile
      icon={TextSearch}
      label="Title check"
      value={`${titleSpamScore}/100`}
      tone={titleSpamScore >= TITLE_SPAM_FLAG ? "danger" : titleSpamScore > 20 ? "warning" : "success"}
      detail={
        titleSpamScore > 20
          ? `${titleSpamLabel(titleSpamScore)} — a common dropshipping SEO tactic`
          : `${titleSpamLabel(titleSpamScore)} — no keyword stuffing found`
      }
    />
  );
}

function Tile({
  icon: Icon,
  label,
  value,
  tone,
  detail,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  tone: Tone;
  detail: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border p-4">
      <p className="flex items-center gap-1.5 text-xs font-medium tracking-wide text-muted-foreground uppercase">
        <Icon className="size-3.5" /> {label}
      </p>
      <p className={cn("mt-1.5 text-2xl font-semibold tracking-tight tabular-nums", TONE_TEXT[tone])}>{value}</p>
      <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{detail}</p>
    </div>
  );
}

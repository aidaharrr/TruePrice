"use client";

import { useEffect, useId, useRef, useState } from "react";
import { AlertCircle, ArrowRight, Infinity as InfinityIcon, Link2, PlayCircle, ScanSearch } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { DEMO_PRODUCT_URL, validateAmazonUrl } from "@/lib/amazon";
import { runScan, ScanError, type ScanReport } from "@/lib/scan/run-scan";
import type { ScrapedProduct } from "@/lib/scrape/extract";
import { FREE_SCAN_LIMIT, type AccountStatus } from "@/lib/account/limits";
import { useAccount } from "@/components/account/account-provider";
import { usePaywall } from "@/components/paywall-modal";
import { ScanProgress } from "@/components/scan/scan-progress";
import { ScanResultCard } from "@/components/scan/scan-result";

type Phase = "idle" | "scanning" | "done";

export function UrlScanner() {
  const inputId = useId();
  const errorId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  const [url, setUrl] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [stepIndex, setStepIndex] = useState(0);
  const [target, setTarget] = useState<{ asin: string | null; url: string } | null>(null);
  const [product, setProduct] = useState<ScrapedProduct | null>(null);
  const [report, setReport] = useState<ScanReport | null>(null);
  const [isDemo, setIsDemo] = useState(false);

  const account = useAccount();
  const { openPaywall } = usePaywall();

  useEffect(() => () => abortRef.current?.abort(), []);

  async function startScan(rawUrl: string, opts: { demo?: boolean } = {}) {
    const check = validateAmazonUrl(rawUrl);
    if (!check.ok) {
      setError(check.error);
      inputRef.current?.focus();
      return;
    }

    // Quick client-side check for a nicer UX; the server enforces the limit regardless (403 SCAN_LIMIT_REACHED).
    if (account.status?.scansRemaining === 0) {
      openPaywall("limit");
      return;
    }

    // Every scan belongs to a session: a real account, or an anonymous guest session created here.
    const session = await account.ensureSession();
    if (!session.ok) {
      setError(session.message);
      return;
    }

    setError(null);
    setIsDemo(!!opts.demo);
    setTarget(check);
    setProduct(null);
    setReport(null);
    setStepIndex(0);
    setPhase("scanning");
    rootRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const result = await runScan(check.url, {
        signal: controller.signal,
        onStep: setStepIndex,
        onProduct: (p, status) => {
          setProduct(p);
          // The server counted this scan once the listing was read; show the new count right away.
          account.setStatus(status);
        },
      });
      setReport(result);
      setPhase("done");
    } catch (e) {
      if (controller.signal.aborted) return;
      setPhase("idle");
      if (e instanceof ScanError && e.code === "SCAN_LIMIT_REACHED") {
        void account.refreshStatus();
        openPaywall("limit");
        return;
      }
      if (e instanceof ScanError && e.code === "AUTH_REQUIRED") account.openAuth("sign-in");
      setError(e instanceof ScanError ? e.message : "Something went wrong while scanning. Please try again.");
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }

  function cancelScan() {
    abortRef.current?.abort();
    setPhase("idle");
  }

  function scanAnother() {
    setPhase("idle");
    setReport(null);
    setProduct(null);
    setUrl("");
    requestAnimationFrame(() => inputRef.current?.focus());
  }

  function runDemo() {
    setUrl(DEMO_PRODUCT_URL);
    void startScan(DEMO_PRODUCT_URL, { demo: true });
  }

  return (
    <div ref={rootRef} className="scroll-mt-24">
      {phase === "scanning" && target && (
        <ScanProgress
          stepIndex={stepIndex}
          asin={target.asin}
          product={product}
          isDemo={isDemo}
          onCancel={cancelScan}
        />
      )}

      {phase === "done" && report && <ScanResultCard report={report} isDemo={isDemo} onScanAnother={scanAnother} />}

      {phase === "idle" && (
        <div className="space-y-4">
          <form
            noValidate
            onSubmit={(e) => {
              e.preventDefault();
              void startScan(url);
            }}
            className={cn(
              "flex flex-col gap-2 rounded-2xl border bg-card p-2 shadow-lg shadow-primary/5 transition-shadow sm:flex-row sm:items-center",
              "focus-within:border-ring focus-within:ring-4 focus-within:ring-ring/15",
              error && "border-destructive/60 focus-within:border-destructive focus-within:ring-destructive/15",
            )}
          >
            <label htmlFor={inputId} className="sr-only">
              Amazon product link
            </label>
            <div className="relative flex-1">
              <Link2
                aria-hidden
                className="pointer-events-none absolute top-1/2 left-3.5 size-5 -translate-y-1/2 text-muted-foreground"
              />
              <Input
                ref={inputRef}
                id={inputId}
                type="url"
                inputMode="url"
                autoComplete="off"
                spellCheck={false}
                placeholder="Paste an amazon.com product link…"
                value={url}
                onChange={(e) => {
                  setUrl(e.target.value);
                  if (error) setError(null);
                }}
                aria-invalid={!!error}
                aria-describedby={error ? errorId : undefined}
                className="h-12 border-0 bg-transparent pl-11 text-base shadow-none focus-visible:ring-0 aria-invalid:ring-0 md:text-base dark:bg-transparent"
              />
            </div>
            <Button type="submit" size="lg" className="h-12 gap-2 rounded-xl px-6 text-base">
              <ScanSearch className="size-5" />
              Scan product
            </Button>
          </form>

          <div className="min-h-5" aria-live="polite">
            {error && (
              <p id={errorId} className="flex items-center gap-1.5 px-2 text-sm font-medium text-destructive">
                <AlertCircle className="size-4 shrink-0" />
                {error}
              </p>
            )}
          </div>

          <div className="flex flex-col items-center justify-between gap-3 sm:flex-row">
            <Button
              type="button"
              variant="outline"
              size="lg"
              onClick={runDemo}
              className="group h-11 w-full gap-2 rounded-full border-primary/30 bg-primary/5 px-5 text-primary hover:bg-primary/10 hover:text-primary sm:w-auto"
            >
              <PlayCircle className="size-5" />
              Try instant demo
              <span className="rounded-full bg-primary px-2 py-0.5 text-[0.7rem] font-semibold tracking-wide text-primary-foreground uppercase">
                No sign-up
              </span>
              <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
            </Button>

            <TrialMeter status={account.status} onUpgrade={() => openPaywall("limit")} />
          </div>
        </div>
      )}
    </div>
  );
}

function TrialMeter({ status, onUpgrade }: { status: AccountStatus | null; onUpgrade: () => void }) {
  if (status && status.scansRemaining === null) {
    return (
      <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
        <InfinityIcon className="size-4 text-success" />
        Unlimited scans ·{" "}
        <span className="font-medium text-foreground">{status.tier === "JUDGE" ? "Judge account" : "Pro"}</span>
      </div>
    );
  }

  // No session yet = a new visitor, who gets the full free allowance.
  const remaining = status?.scansRemaining ?? FREE_SCAN_LIMIT;
  return (
    <div className="flex items-center gap-3 text-sm text-muted-foreground">
      <div className="flex gap-1" aria-hidden>
        {Array.from({ length: FREE_SCAN_LIMIT }).map((_, i) => (
          <span
            key={i}
            className={cn("h-1.5 w-5 rounded-full transition-colors", i < remaining ? "bg-success" : "bg-border")}
          />
        ))}
      </div>
      {remaining > 0 ? (
        <span>
          <span className="font-medium text-foreground tabular-nums">{remaining}</span> of {FREE_SCAN_LIMIT} free scans
          left
        </span>
      ) : (
        <button type="button" onClick={onUpgrade} className="font-medium text-primary hover:underline">
          Sign up and upgrade to continue
        </button>
      )}
    </div>
  );
}

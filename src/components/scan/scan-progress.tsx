"use client";

import Image from "next/image";
import { Check, Loader2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import { SCAN_STEPS } from "@/lib/scan/steps";
import type { ScrapedProduct } from "@/lib/scrape/extract";

const usd = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD" });

export function ScanProgress({
  stepIndex,
  asin,
  product,
  isDemo,
  onCancel,
}: {
  /** Index into SCAN_STEPS of the step currently running. */
  stepIndex: number;
  asin: string | null;
  /** Filled in as soon as /api/scrape returns, while the slower checks run. */
  product: ScrapedProduct | null;
  isDemo: boolean;
  onCancel: () => void;
}) {
  const total = SCAN_STEPS.length;
  const pct = Math.min(100, Math.round(((stepIndex + 0.5) / total) * 100));
  const current = SCAN_STEPS[Math.min(stepIndex, total - 1)];

  return (
    <Card className="overflow-hidden text-left shadow-lg shadow-primary/5" aria-busy="true">
      <CardHeader className="gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <span className="relative flex size-2.5">
              <span className="absolute inline-flex size-full animate-ping rounded-full bg-primary/60" />
              <span className="relative inline-flex size-2.5 rounded-full bg-primary" />
            </span>
            <p className="font-medium">Scanning product</p>
            <Badge variant="secondary" className="font-mono">
              {asin ?? "a.co link"}
            </Badge>
            {isDemo && <Badge variant="outline">Demo product</Badge>}
          </div>
          <Button variant="ghost" size="sm" onClick={onCancel} className="gap-1 text-muted-foreground">
            <X className="size-3.5" /> Cancel
          </Button>
        </div>
        <Progress value={pct} aria-label="Scan progress" className="[&_[data-slot=progress-track]]:h-1.5" />
        <p className="text-sm text-muted-foreground" aria-live="polite">
          Step {Math.min(stepIndex + 1, total)} of {total}: {current.detail}…
        </p>
      </CardHeader>

      <CardContent className="space-y-6">
        <ol className="grid gap-2 sm:grid-cols-3">
          {SCAN_STEPS.map((step, i) => {
            const status = i < stepIndex ? "done" : i === stepIndex ? "active" : "pending";
            const Icon = step.icon;
            return (
              <li
                key={step.id}
                className={cn(
                  "flex items-center gap-3 rounded-xl border p-3 transition-colors duration-300",
                  status === "active" && "border-primary/40 bg-primary/5",
                  status === "done" && "border-success/30 bg-success/5",
                  status === "pending" && "opacity-60",
                )}
              >
                <span
                  className={cn(
                    "grid size-9 shrink-0 place-items-center rounded-lg",
                    status === "active" && "bg-primary text-primary-foreground",
                    status === "done" && "bg-success text-success-foreground",
                    status === "pending" && "bg-muted text-muted-foreground",
                  )}
                >
                  {status === "done" ? <Check className="size-4.5" strokeWidth={3} /> : <Icon className="size-4.5" />}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">{step.label}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {status === "done" ? "Complete" : status === "active" ? "In progress…" : "Waiting"}
                  </p>
                </div>
                {status === "active" && <Loader2 className="size-4 shrink-0 animate-spin text-primary" />}
              </li>
            );
          })}
        </ol>

        <Separator />

        {product ? (
          <div className="flex gap-4">
            <div className="relative size-20 shrink-0 overflow-hidden rounded-xl border bg-white">
              <Image src={product.imageUrl} alt="" fill sizes="80px" className="object-contain p-1" />
            </div>
            <div className="min-w-0 flex-1 py-1">
              <p className="line-clamp-2 font-medium leading-snug">{product.title}</p>
              <p className="mt-1 text-sm text-muted-foreground">{usd(product.price)} on Amazon</p>
            </div>
          </div>
        ) : (
          <div className="flex gap-4" aria-hidden>
            <Skeleton className="size-20 shrink-0 rounded-xl" />
            <div className="flex-1 space-y-2.5 py-1">
              <Skeleton className="h-4 w-4/5" />
              <Skeleton className="h-4 w-3/5" />
              <Skeleton className="h-3 w-2/5" />
            </div>
          </div>
        )}

        <div className="grid gap-3 sm:grid-cols-3" aria-hidden>
          {[0, 1, 2].map((i) => (
            <div key={i} className="space-y-2 rounded-xl border p-4">
              <Skeleton className="h-3 w-1/2" />
              <Skeleton className="h-7 w-2/3" />
              <Skeleton className="h-3 w-full" />
            </div>
          ))}
        </div>
        <p className="text-center text-xs text-muted-foreground">
          Live scans usually take 30–60 seconds — most of it is reading the Amazon page.
        </p>
      </CardContent>
    </Card>
  );
}

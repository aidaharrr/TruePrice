"use client";

import { createContext, useCallback, useContext, useMemo, useState } from "react";
import { BadgeCheck, Check, CircleCheck, Loader2, Lock, Sparkles, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { FREE_SCAN_LIMIT } from "@/lib/account/limits";
import { useAccount } from "@/components/account/account-provider";

export const PRO_PRICE = "$4.99";

type PaywallReason = "limit" | "pricing";
type CheckoutState = "idle" | "redirecting" | "mocked";

type PaywallContextValue = {
  openPaywall: (reason?: PaywallReason) => void;
  closePaywall: () => void;
};

const PaywallContext = createContext<PaywallContextValue | null>(null);

export function usePaywall() {
  const ctx = useContext(PaywallContext);
  if (!ctx) throw new Error("usePaywall must be used inside <PaywallProvider>");
  return ctx;
}

export function PaywallProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<PaywallReason>("limit");

  const openPaywall = useCallback((r: PaywallReason = "limit") => {
    setReason(r);
    setOpen(true);
  }, []);
  const closePaywall = useCallback(() => setOpen(false), []);

  const value = useMemo(() => ({ openPaywall, closePaywall }), [openPaywall, closePaywall]);

  return (
    <PaywallContext.Provider value={value}>
      {children}
      <PaywallModal open={open} onOpenChange={setOpen} reason={reason} />
    </PaywallContext.Provider>
  );
}

const FEATURES = [
  "Unlimited product scans",
  "Original supplier price & exact markup",
  "AI-generated photo detection",
  "Keyword-stuffed title & Ghost Listing alerts",
];

function PaywallModal({
  open,
  onOpenChange,
  reason,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  reason: PaywallReason;
}) {
  const [checkout, setCheckout] = useState<CheckoutState>("idle");
  const account = useAccount();

  const handleOpenChange = (next: boolean) => {
    if (checkout === "redirecting") return; // don't close mid-"redirect"
    onOpenChange(next);
    if (!next) setTimeout(() => setCheckout("idle"), 200);
  };

  const handleSubscribe = () => {
    // MOCK: replace with a POST to /api/checkout that returns a Stripe Checkout URL.
    setCheckout("redirecting");
    setTimeout(() => setCheckout("mocked"), 1600);
  };

  const isLimit = reason === "limit";

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="gap-0 overflow-hidden p-0 sm:max-w-md [&>[data-slot=dialog-close]]:top-3 [&>[data-slot=dialog-close]]:right-3 [&>[data-slot=dialog-close]]:text-white/80 [&>[data-slot=dialog-close]]:hover:bg-white/15 [&>[data-slot=dialog-close]]:hover:text-white">
        {/* Header band */}
        <div className="relative bg-gradient-to-br from-primary to-[oklch(0.38_0.16_268)] px-6 pt-7 pb-6 text-primary-foreground">
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 opacity-25 [background:radial-gradient(circle_at_85%_10%,white,transparent_45%)]"
          />
          <DialogHeader className="relative gap-3">
            <Badge className="border-white/25 bg-white/15 text-white">
              <Sparkles /> TruePrice Pro
            </Badge>
            <DialogTitle className="text-2xl leading-tight font-semibold tracking-tight text-white">
              {isLimit ? `You've used your ${FREE_SCAN_LIMIT} free scans` : "Never overpay for dropshipped junk"}
            </DialogTitle>
            <DialogDescription className="text-pretty text-white/80">
              {isLimit
                ? "Sign up and upgrade to continue. Spotting a single 5× markup usually pays for a whole year."
                : "Unlimited scans that reveal the factory source, the real price and AI-faked photos."}
            </DialogDescription>
          </DialogHeader>
        </div>

        <div className="space-y-5 px-6 py-6">
          {/* Price */}
          <div className="flex items-end justify-between gap-4">
            <div>
              <div className="flex items-baseline gap-1">
                <span className="text-4xl font-semibold tracking-tight tabular-nums">{PRO_PRICE}</span>
                <span className="text-muted-foreground">/month</span>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">Billed monthly · Cancel anytime</p>
            </div>
            <Badge variant="secondary" className="mb-1 text-success">
              <BadgeCheck /> Unlimited scans
            </Badge>
          </div>

          {/* Features */}
          <ul className="space-y-2.5 text-sm">
            {FEATURES.map((f) => (
              <li key={f} className="flex items-start gap-2.5">
                <span className="mt-0.5 grid size-4.5 shrink-0 place-items-center rounded-full bg-success/12 text-success">
                  <Check className="size-3" strokeWidth={3} />
                </span>
                {f}
              </li>
            ))}
          </ul>

          {/* Step 1 for guests: a real account, so the upgrade has someone to belong to. */}
          {!account.isSignedIn && (
            <Button
              size="lg"
              variant="outline"
              onClick={() => {
                handleOpenChange(false);
                account.openAuth("sign-up");
              }}
              className="h-12 w-full gap-2 rounded-xl text-base"
            >
              <UserPlus className="size-4" /> Create a free account
            </Button>
          )}

          {/* CTA */}
          {checkout === "mocked" ? (
            <div
              role="status"
              className="flex items-start gap-3 rounded-lg border border-success/30 bg-success/8 p-3.5 text-sm"
            >
              <CircleCheck className="mt-0.5 size-5 shrink-0 text-success" />
              <div>
                <p className="font-medium">Stripe Checkout would open here</p>
                <p className="text-muted-foreground">
                  Payments are mocked in this demo build — no card was charged.
                </p>
              </div>
            </div>
          ) : (
            <Button
              size="lg"
              onClick={handleSubscribe}
              disabled={checkout === "redirecting"}
              className="h-12 w-full gap-2 rounded-xl bg-[#635bff] text-base text-white shadow-md shadow-[#635bff]/25 hover:bg-[#5249e6]"
            >
              {checkout === "redirecting" ? (
                <>
                  <Loader2 className="size-4.5 animate-spin" /> Redirecting to Stripe…
                </>
              ) : (
                <>
                  <Lock className="size-4" /> Subscribe with Stripe
                </>
              )}
            </Button>
          )}

          <div className="flex flex-col items-center gap-2">
            <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Lock className="size-3" /> Secure payment processed by Stripe. We never see your card.
            </p>
            <Button variant="link" size="sm" className="text-muted-foreground" onClick={() => handleOpenChange(false)}>
              Maybe later
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

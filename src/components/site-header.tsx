"use client";

import Link from "next/link";
import { LogOut, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Logo } from "@/components/logo";
import { usePaywall } from "@/components/paywall-modal";
import { useAccount } from "@/components/account/account-provider";

const TIER_LABEL = { GUEST: "Free", PRO: "Pro", JUDGE: "Judge" } as const;

const COMING_SOON_ID = "coming-soon";

/** Smooth-scrolls to the Coming Soon section on the landing page; from any other page, follows the link there. */
function scrollToComingSoon(e: React.MouseEvent<HTMLAnchorElement>) {
  const section = document.getElementById(COMING_SOON_ID);
  if (!section) return;
  e.preventDefault();
  // No history/hash update: Next's router intercepts history changes and would interrupt the smooth scroll.
  section.scrollIntoView({ behavior: "smooth", block: "start" });
}

export function SiteHeader() {
  const { openPaywall } = usePaywall();
  const account = useAccount();
  const tier = account.status?.tier ?? "GUEST";

  return (
    <header className="sticky top-0 z-40 border-b border-border/70 bg-background/80 backdrop-blur-md supports-backdrop-filter:bg-background/70">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
        <div className="flex min-w-0 items-center gap-1.5">
          <Link href="/" aria-label="TruePrice home" className="rounded-md outline-none focus-visible:ring-3 focus-visible:ring-ring/50">
            <Logo />
          </Link>
          {/* Below lg: icon-only, since the text nav is hidden there. */}
          <a
            href={`/#${COMING_SOON_ID}`}
            onClick={scrollToComingSoon}
            aria-label="Coming soon"
            title="Coming soon"
            className="grid size-8 place-items-center rounded-full text-primary outline-none transition-colors hover:bg-primary/10 focus-visible:ring-3 focus-visible:ring-ring/50 lg:hidden"
          >
            <Sparkles className="size-4" />
          </a>
        </div>

        <nav className="hidden items-center gap-1 text-sm whitespace-nowrap text-muted-foreground lg:flex">
          <a href="#how-it-works" className="rounded-md px-3 py-2 transition-colors hover:text-foreground">
            How it works
          </a>
          <a href="#what-we-check" className="rounded-md px-3 py-2 transition-colors hover:text-foreground">
            What we check
          </a>
          <a
            href={`/#${COMING_SOON_ID}`}
            onClick={scrollToComingSoon}
            className="inline-flex items-center gap-1.5 rounded-md px-3 py-2 transition-colors hover:text-foreground"
          >
            <Sparkles className="size-3.5 text-primary" />
            Coming soon
          </a>
          <button
            type="button"
            onClick={() => openPaywall("pricing")}
            className="rounded-md px-3 py-2 transition-colors hover:text-foreground"
          >
            Pricing
          </button>
        </nav>

        <div className="flex items-center gap-2">
          {account.isSignedIn ? (
            <>
              <div className="hidden min-w-0 items-center gap-2 text-sm sm:flex">
                <span className="max-w-40 truncate text-muted-foreground" title={account.user?.email ?? undefined}>
                  {account.user?.email}
                </span>
                <Badge variant={tier === "GUEST" ? "secondary" : "default"}>{TIER_LABEL[tier]}</Badge>
              </div>
              <Button variant="ghost" size="lg" className="gap-1.5" onClick={() => void account.signOut()}>
                <LogOut className="size-4" />
                <span className="hidden sm:inline">Sign out</span>
              </Button>
            </>
          ) : (
            <Button
              variant="ghost"
              size="lg"
              disabled={!account.configured}
              title={account.configured ? undefined : "Accounts aren't configured on this server"}
              onClick={() => account.openAuth("sign-in")}
            >
              Sign in
            </Button>
          )}
          {tier === "GUEST" && (
            <Button size="lg" className="px-4" onClick={() => openPaywall("pricing")}>
              Go Pro
            </Button>
          )}
        </div>
      </div>
    </header>
  );
}

import {
  Bot,
  Clapperboard,
  ClipboardPaste,
  Hourglass,
  Images,
  Lock,
  MessageSquareWarning,
  ShieldCheck,
  TextSearch,
  Timer,
  UserX,
} from "lucide-react";
import { UrlScanner } from "@/components/scan/url-scanner";

const CHECKS = [
  {
    icon: Images,
    title: "Dropshipping markups",
    body: "We reverse-search the product photo across AliExpress, Temu and Alibaba — then its title, if the photo was altered — to find the factory listing and what it really costs.",
  },
  {
    icon: Bot,
    title: "AI-generated photos",
    body: "Our vision model flags product images that were generated or heavily edited, so you see what will actually show up at your door.",
  },
  {
    icon: TextSearch,
    title: "Keyword-stuffed titles",
    body: "Titles packed with every audience and buzzword are a classic dropshipping SEO trick. We score them — and flag Ghost Listings with no traceable source.",
  },
];

const COMING_SOON = [
  {
    icon: MessageSquareWarning,
    title: "AI Review Analysis",
    body: "Detects fake and incentivized reviews — burst posting, copy-paste phrasing and rating patterns that don't match real buyers.",
  },
  {
    icon: Clapperboard,
    title: "TikTok Shop Integration",
    body: "Paste a TikTok Shop link to trace viral products back to their factory listing and see the real markup.",
  },
];

const STEPS = [
  { icon: ClipboardPaste, title: "Paste a link", body: "Copy any amazon.com product URL from your browser or the Amazon app." },
  { icon: ShieldCheck, title: "We check it 3 ways", body: "We read the listing, search factory marketplaces by image and title, and run an AI photo and title check." },
  { icon: Timer, title: "Buy with confidence", body: "Get a clear verdict and the factory price before you hit “Buy Now”." },
];

export default function Home() {
  return (
    <>
      {/* Hero */}
      <section className="relative overflow-hidden">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 -z-10 [background:radial-gradient(60%_50%_at_50%_0%,color-mix(in_oklch,var(--primary)_14%,transparent),transparent_70%)]"
        />
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 -z-10 opacity-[0.35] [background-image:linear-gradient(var(--border)_1px,transparent_1px),linear-gradient(90deg,var(--border)_1px,transparent_1px)] [background-size:44px_44px] [mask-image:radial-gradient(ellipse_at_top,black_20%,transparent_70%)]"
        />

        <div className="mx-auto max-w-3xl px-4 pt-14 pb-16 text-center sm:px-6 sm:pt-20 sm:pb-24">
          <p className="mx-auto mb-5 inline-flex items-center gap-2 rounded-full border bg-background/80 px-3 py-1 text-xs font-medium text-muted-foreground shadow-xs">
            <span className="size-1.5 rounded-full bg-success" />
            Free for your first 3 products
          </p>
          <h1 className="text-4xl font-semibold tracking-tight text-balance sm:text-5xl md:text-6xl">
            Can you trust the <span className="text-primary">Amazon listing</span>?
          </h1>
          <p className="mx-auto mt-5 max-w-2xl text-lg text-pretty text-muted-foreground">
            Paste any Amazon link. TruePrice instantly traces the dropshipping factors, detects AI-altered imagery, and
            analyzes listing metadata to reveal the true market value.
          </p>

          <div className="mt-10">
            <UrlScanner />
          </div>

          <ul className="mt-8 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-sm text-muted-foreground">
            <li className="flex items-center gap-1.5">
              <UserX className="size-4" /> No account needed for 3 scans
            </li>
            <li className="flex items-center gap-1.5">
              <Timer className="size-4" /> Results in about a minute
            </li>
            <li className="flex items-center gap-1.5">
              <Lock className="size-4" /> We never ask for your Amazon login
            </li>
          </ul>
        </div>
      </section>

      {/* Coming soon */}
      <section id="coming-soon" aria-labelledby="coming-soon-title" className="scroll-mt-20 border-t">
        <div className="mx-auto max-w-6xl px-4 py-14 sm:px-6">
          <div className="flex flex-col items-start justify-between gap-3 sm:flex-row sm:items-end">
            <div>
              <p className="inline-flex items-center gap-1.5 text-sm font-medium text-primary">
                <Hourglass className="size-4" /> Coming soon
              </p>
              <h2 id="coming-soon-title" className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">
                What we&apos;re building next
              </h2>
            </div>
            <p className="max-w-sm text-sm text-muted-foreground">
              Pro subscribers get every new check as soon as it ships — no extra cost.
            </p>
          </div>
          <div className="mt-8 grid gap-4 md:grid-cols-2">
            {COMING_SOON.map(({ icon: Icon, title, body }) => (
              <div
                key={title}
                className="group relative overflow-hidden rounded-2xl border bg-card p-6 shadow-xs transition-shadow hover:shadow-md"
              >
                <div
                  aria-hidden
                  className="pointer-events-none absolute -top-16 -right-16 size-48 rounded-full bg-primary/8 blur-2xl transition-opacity group-hover:opacity-100"
                />
                <div className="relative flex items-start gap-4">
                  <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-primary to-[oklch(0.38_0.16_268)] text-primary-foreground shadow-sm">
                    <Icon className="size-5" />
                  </span>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="font-semibold">{title}</h3>
                      <span className="rounded-full border border-primary/25 bg-primary/5 px-2 py-0.5 text-[0.7rem] font-semibold tracking-wide text-primary uppercase">
                        Coming soon
                      </span>
                    </div>
                    <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{body}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* What we check */}
      <section id="what-we-check" className="scroll-mt-20 border-t bg-muted/30">
        <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-20">
          <div className="max-w-2xl">
            <p className="text-sm font-medium text-primary">What we check</p>
            <h2 className="mt-2 text-3xl font-semibold tracking-tight text-balance">
              Three things Amazon listings won&apos;t tell you
            </h2>
          </div>
          <div className="mt-10 grid gap-4 md:grid-cols-3">
            {CHECKS.map(({ icon: Icon, title, body }) => (
              <div key={title} className="rounded-2xl border bg-card p-6 shadow-xs">
                <span className="grid size-10 place-items-center rounded-xl bg-primary/10 text-primary">
                  <Icon className="size-5" />
                </span>
                <h3 className="mt-4 font-semibold">{title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* How it works */}
      <section id="how-it-works" className="scroll-mt-20 border-t">
        <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-20">
          <div className="max-w-2xl">
            <p className="text-sm font-medium text-primary">How it works</p>
            <h2 className="mt-2 text-3xl font-semibold tracking-tight">From link to verdict in seconds</h2>
          </div>
          <ol className="mt-10 grid gap-8 md:grid-cols-3">
            {STEPS.map(({ icon: Icon, title, body }, i) => (
              <li key={title} className="flex gap-4">
                <span className="grid size-10 shrink-0 place-items-center rounded-full border bg-card font-semibold tabular-nums text-primary">
                  {i + 1}
                </span>
                <div>
                  <h3 className="flex items-center gap-2 font-semibold">
                    <Icon className="size-4 text-muted-foreground" /> {title}
                  </h3>
                  <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{body}</p>
                </div>
              </li>
            ))}
          </ol>
        </div>
      </section>
    </>
  );
}

import { Logo } from "@/components/logo";

export function SiteFooter() {
  return (
    <footer className="border-t border-border/70 bg-muted/40">
      <div className="mx-auto flex max-w-6xl flex-col gap-4 px-4 py-8 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <Logo className="text-foreground" />
        <p className="max-w-md text-pretty">
          TruePrice is independent and not affiliated with Amazon. Results are estimates to help you shop
          smarter — always use your own judgment.
        </p>
        <p className="shrink-0">© {new Date().getFullYear()} TruePrice</p>
      </div>
    </footer>
  );
}

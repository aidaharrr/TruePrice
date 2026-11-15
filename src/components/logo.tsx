import { ShieldCheck } from "lucide-react";
import { cn } from "@/lib/utils";

export function Logo({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-2 font-semibold tracking-tight", className)}>
      <span className="grid size-8 place-items-center rounded-lg bg-primary text-primary-foreground shadow-sm">
        <ShieldCheck className="size-4.5" strokeWidth={2.25} />
      </span>
      <span className="text-[1.05rem]">
        True<span className="text-primary">Price</span>
      </span>
    </span>
  );
}

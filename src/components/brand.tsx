import { cn } from "@/lib/utils";

export function Logo({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-2 font-semibold tracking-tight", className)}>
      <span className="grid size-8 place-items-center rounded-lg bg-[var(--terminal-bg)] font-mono text-sm font-bold text-[#7ee787] ring-1 ring-white/10">
        &gt;_
      </span>
      <span>
        Linux<span className="text-primary">Playground</span>
      </span>
    </span>
  );
}

"use client";

import { Play } from "lucide-react";
import { cn } from "@/lib/utils";

export function CommandChip({ command, explanation, onRun, className }: { command: string; explanation?: string; onRun: (cmd: string) => void; className?: string }) {
  return (
    <button
      type="button"
      onClick={() => onRun(command)}
      className={cn("group flex w-full items-start gap-2 rounded-lg border bg-card px-3 py-2 text-left transition-colors hover:border-primary/50 hover:bg-primary/5", className)}
      title="Run in the terminal"
    >
      <Play className="mt-0.5 size-3.5 shrink-0 text-primary opacity-70 group-hover:opacity-100" />
      <span className="min-w-0">
        <code className="block break-all font-mono text-[0.8rem] text-foreground">{command}</code>
        {explanation && <span className="mt-0.5 block text-xs text-muted-foreground">{explanation}</span>}
      </span>
    </button>
  );
}

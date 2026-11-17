"use client";

import { stripAnsiClient } from "./strip";

export interface CommandResult {
  command: string;
  output: string;
  exitCode: number;
}

/** Shows the shell command a GUI action ran, and its output – the GUI teaches the CLI. */
export function CommandResultView({ result }: { result: CommandResult | null }) {
  if (!result) return null;
  const out = stripAnsiClient(result.output).trim();
  return (
    <div className="rounded-lg border bg-[var(--terminal-bg)] p-3 font-mono text-xs text-[#d7dde6]">
      <p className="text-white/50">Equivalent command:</p>
      <p>
        <span className="text-[#7ee787]">$</span> {result.command}
      </p>
      {out && <pre className={`mt-1 max-h-40 overflow-auto whitespace-pre-wrap ${result.exitCode ? "text-[#ff7b72]" : "text-white/80"}`}>{out}</pre>}
    </div>
  );
}

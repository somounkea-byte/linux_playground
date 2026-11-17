"use client";

import { CheckCircle2, Circle, Eye, Lightbulb, Loader2, PartyPopper, ShieldCheck } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { LinuxTerminal } from "@/components/terminal/terminal";
import { api } from "@/lib/api-client";
import { cn } from "@/lib/utils";

interface Result {
  id: string;
  description: string;
  passed: boolean;
  detail?: string;
}

export function ChallengeWorkspace({
  slug,
  tasks,
  hintsCount,
  initialResults,
  initialHints,
  passed: initiallyPassed,
  attempts: initialAttempts,
  solutionThreshold,
  instructions,
}: {
  slug: string;
  tasks: { id: string; description: string }[];
  hintsCount: number;
  initialResults: Result[];
  initialHints: string[];
  passed: boolean;
  attempts: number;
  solutionThreshold: number;
  instructions: React.ReactNode;
}) {
  const router = useRouter();
  const [results, setResults] = useState<Result[]>(initialResults);
  const [checking, setChecking] = useState(false);
  const [passed, setPassed] = useState(initiallyPassed);
  const [attempts, setAttempts] = useState(initialAttempts);
  const [hints, setHints] = useState<string[]>(initialHints);
  const [solution, setSolution] = useState<string | null>(null);
  const byId = new Map(results.map((r) => [r.id, r]));

  async function check() {
    setChecking(true);
    try {
      const r = await api<{ results: Result[]; passed: boolean; score: number; award: { awarded: boolean; amount: number; leveledUp: boolean; level: number } | null; badges: string[] }>(`/api/challenges/${slug}/check`, { body: {} });
      setResults(r.results);
      setAttempts((a) => a + 1);
      if (r.passed) {
        setPassed(true);
        toast.success(r.award?.awarded ? `Challenge solved! +${r.award.amount} XP` : "All tasks pass – challenge solved!", { icon: <PartyPopper className="size-4" /> });
        if (r.award?.leveledUp) toast.success(`Level up! Level ${r.award.level} 🎉`);
        for (const b of r.badges) toast.success(`New badge: ${b} 🏅`);
        router.refresh();
      } else toast.info(`${r.results.filter((x) => x.passed).length} of ${r.results.length} tasks complete (${r.score}%)`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Check failed");
    } finally {
      setChecking(false);
    }
  }

  async function nextHint() {
    try {
      const r = await api<{ hint: string }>(`/api/challenges/${slug}/hint`, { body: { index: hints.length } });
      setHints([...hints, r.hint]);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "No hint");
    }
  }

  async function showSolution() {
    try {
      setSolution((await api<{ solution: string }>(`/api/challenges/${slug}/solution`)).solution);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Locked");
    }
  }

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
      <div className="min-w-0 space-y-5">
        <section className="rounded-xl border bg-card p-5">{instructions}</section>
        <section className="rounded-xl border bg-card p-5">
          <div className="mb-3 flex items-center justify-between gap-2">
            <h2 className="flex items-center gap-2 font-semibold">
              <ShieldCheck className="size-4 text-primary" /> Tasks
            </h2>
            <span className="text-xs text-muted-foreground">{attempts} check{attempts === 1 ? "" : "s"}</span>
          </div>
          <ul className="space-y-2">
            {tasks.map((t) => {
              const r = byId.get(t.id);
              return (
                <li key={t.id} className="flex items-start gap-2.5 text-sm">
                  {r?.passed ? <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" /> : <Circle className={cn("mt-0.5 size-4 shrink-0", r ? "text-destructive" : "text-muted-foreground")} />}
                  <span>
                    {t.description}
                    {r && !r.passed && r.detail && <span className="block text-xs text-destructive/90">{r.detail}</span>}
                  </span>
                </li>
              );
            })}
          </ul>
          <Button className="mt-4 w-full" onClick={check} disabled={checking}>
            {checking ? <Loader2 className="animate-spin" /> : <ShieldCheck />} Check my work
          </Button>
          {passed && (
            <p className="mt-3 flex items-center justify-center gap-2 rounded-lg bg-success/10 py-2 text-sm font-medium text-success">
              <PartyPopper className="size-4" /> Challenge solved
            </p>
          )}
        </section>
        <section className="rounded-xl border bg-card p-5">
          <h2 className="mb-3 flex items-center gap-2 font-semibold">
            <Lightbulb className="size-4 text-warning" /> Hints
          </h2>
          {hints.length === 0 && <p className="text-sm text-muted-foreground">Stuck? Reveal hints one at a time. Your teacher can see how many you used.</p>}
          <ol className="list-decimal space-y-1.5 pl-5 text-sm">
            {hints.map((h, i) => (
              <li key={i}>{h}</li>
            ))}
          </ol>
          <div className="mt-3 flex flex-wrap gap-2">
            {hints.length < hintsCount && (
              <Button size="sm" variant="outline" onClick={nextHint}>
                <Lightbulb /> Reveal hint {hints.length + 1}/{hintsCount}
              </Button>
            )}
            <Button size="sm" variant="ghost" onClick={showSolution} disabled={!passed && attempts < solutionThreshold} title={!passed && attempts < solutionThreshold ? `Unlocks after ${solutionThreshold} checks or solving` : ""}>
              <Eye /> Solution
            </Button>
          </div>
          {solution && <pre className="mt-3 overflow-x-auto rounded-lg bg-[var(--terminal-bg)] p-3 font-mono text-xs leading-5 text-[#d7dde6]">{solution}</pre>}
        </section>
      </div>
      <div className="min-w-0 xl:sticky xl:top-20 xl:h-[calc(100vh-6rem)]">
        <LinuxTerminal target={{ kind: "challenge", slug }} height="100%" className="h-[560px] xl:h-full" />
      </div>
    </div>
  );
}

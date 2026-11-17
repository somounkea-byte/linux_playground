"use client";

import { ArrowLeft, ArrowRight, CheckCircle2, Circle, Loader2, PartyPopper, RefreshCw, Target } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Button, buttonVariants } from "@/components/ui/button";
import { CommandChip } from "@/components/terminal/command-chips";
import { LinuxTerminal, type TerminalController } from "@/components/terminal/terminal";
import { api, ApiClientError } from "@/lib/api-client";
import { cn } from "@/lib/utils";

interface CheckResult {
  id: string;
  description: string;
  passed: boolean;
  detail?: string;
}

export function LessonView({
  lesson,
  content,
  practice,
  hasChecks,
  done,
  isStudent,
  prev,
  next,
  moduleHref,
}: {
  lesson: { id: string; title: string; xpReward: number };
  content: React.ReactNode;
  practice: { command: string; explanation: string }[];
  hasChecks: boolean;
  done: boolean;
  isStudent: boolean;
  prev: string | null;
  next: string | null;
  moduleHref: string;
}) {
  const router = useRouter();
  const ctrl = useRef<TerminalController | null>(null);
  const [checks, setChecks] = useState<CheckResult[]>([]);
  const [checking, setChecking] = useState(false);
  const [completing, setCompleting] = useState(false);
  const [isDone, setIsDone] = useState(done);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const refreshChecks = useCallback(async () => {
    if (!hasChecks) return;
    setChecking(true);
    try {
      setChecks(await api<CheckResult[]>(`/api/lessons/${lesson.id}/checks`));
    } catch {
      /* ignore */
    } finally {
      setChecking(false);
    }
  }, [hasChecks, lesson.id]);

  useEffect(() => {
    void refreshChecks();
  }, [refreshChecks]);

  const onCommand = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void refreshChecks(), 400);
  }, [refreshChecks]);

  const allPassed = !hasChecks || (checks.length > 0 && checks.every((c) => c.passed));

  async function complete() {
    setCompleting(true);
    try {
      const r = await api<{ award: { awarded: boolean; amount: number; leveledUp: boolean; level: number }; badges: string[] }>(`/api/lessons/${lesson.id}/complete`, { body: {} });
      setIsDone(true);
      if (r.award.awarded) toast.success(`Lesson complete! +${r.award.amount} XP`, { icon: <PartyPopper className="size-4" /> });
      else toast.success("Lesson completed");
      if (r.award.leveledUp) toast.success(`Level up! You reached level ${r.award.level} 🎉`);
      for (const b of r.badges) toast.success(`New badge: ${b} 🏅`);
      router.refresh();
      if (next) router.push(next);
    } catch (e) {
      if (e instanceof ApiClientError && e.details && typeof e.details === "object" && "results" in e.details) {
        setChecks((e.details as { results: CheckResult[] }).results);
      }
      toast.error(e instanceof Error ? e.message : "Could not complete the lesson");
    } finally {
      setCompleting(false);
    }
  }

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <div className="min-w-0 space-y-6">
        <article className="rounded-xl border bg-card p-6">{content}</article>

        {practice.length > 0 && (
          <section className="rounded-xl border bg-card p-5">
            <h2 className="mb-1 font-semibold">Try it in the terminal</h2>
            <p className="mb-3 text-sm text-muted-foreground">Click a command to run it, or type it yourself – typing builds muscle memory!</p>
            <div className="grid gap-2 sm:grid-cols-2">
              {practice.map((p) => (
                <CommandChip key={p.command} command={p.command} explanation={p.explanation} onRun={(c) => ctrl.current?.run(c)} />
              ))}
            </div>
          </section>
        )}

        {hasChecks && (
          <section className="rounded-xl border bg-card p-5">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="flex items-center gap-2 font-semibold">
                <Target className="size-4 text-primary" /> Practice tasks
              </h2>
              <Button size="xs" variant="ghost" onClick={() => refreshChecks()} disabled={checking}>
                <RefreshCw className={cn(checking && "animate-spin")} /> Check
              </Button>
            </div>
            <ul className="space-y-2">
              {(checks.length ? checks : []).map((c) => (
                <li key={c.id} className="flex items-start gap-2.5 text-sm">
                  {c.passed ? <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" /> : <Circle className="mt-0.5 size-4 shrink-0 text-muted-foreground" />}
                  <span className={cn(c.passed && "text-muted-foreground line-through decoration-success/50")}>{c.description}</span>
                </li>
              ))}
              {!checks.length && <li className="text-sm text-muted-foreground">Loading tasks…</li>}
            </ul>
            <p className="mt-3 text-xs text-muted-foreground">Tasks are verified against the real state of your machine – any correct method counts.</p>
          </section>
        )}

        <div className="flex flex-wrap items-center gap-3">
          {prev ? (
            <Link href={prev} className={buttonVariants({ variant: "outline" })}>
              <ArrowLeft /> Previous
            </Link>
          ) : (
            <Link href={moduleHref} className={buttonVariants({ variant: "outline" })}>
              <ArrowLeft /> Module
            </Link>
          )}
          <div className="flex-1" />
          {isStudent &&
            (isDone ? (
              <span className="flex items-center gap-1.5 text-sm font-medium text-success">
                <CheckCircle2 className="size-4" /> Completed
              </span>
            ) : (
              <Button onClick={complete} disabled={completing || !allPassed} title={allPassed ? "" : "Complete the practice tasks first"}>
                {completing ? <Loader2 className="animate-spin" /> : <CheckCircle2 />} Mark as complete (+{lesson.xpReward} XP)
              </Button>
            ))}
          {next && (
            <Link href={next} className={buttonVariants({ variant: isDone || !isStudent ? "default" : "outline" })}>
              Next <ArrowRight />
            </Link>
          )}
        </div>
      </div>
      <div className="min-w-0 xl:sticky xl:top-20 xl:h-[calc(100vh-6rem)]">
        <LinuxTerminal controllerRef={ctrl} onCommand={onCommand} height="100%" className="h-[520px] xl:h-full" banner={false} />
      </div>
    </div>
  );
}

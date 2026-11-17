"use client";

import { Clock, ListChecks, Loader2, Play, Send } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/lib/api-client";
import { cn } from "@/lib/utils";

export interface PublicQuestion {
  id: string;
  type: string;
  prompt: string;
  points: number;
  command?: string;
  multiple?: boolean;
  choices?: { id: number; text: string }[];
  left?: string[];
  right?: { id: number; text: string }[];
  task?: string;
  format?: string;
  placeholder?: string;
}

interface Attempt {
  id: string;
  expiresAt: string | null;
  questions: PublicQuestion[];
}

const TYPE_LABEL: Record<string, string> = {
  MULTIPLE_CHOICE: "Multiple choice",
  TRUE_FALSE: "True / false",
  FILL_BLANK: "Fill in the blank",
  MATCHING: "Match",
  PERMISSION: "Permissions",
  PREDICT_OUTPUT: "Predict the output",
  PRACTICAL: "Practical task",
};

/** Inline code formatting for `backticks` in question prompts. */
export function Prompt({ text }: { text: string }) {
  const parts = text.split(/(`[^`]+`)/g);
  return (
    <>
      {parts.map((p, i) =>
        p.startsWith("`") ? (
          <code key={i} className="rounded bg-muted px-1 font-mono text-[0.9em]">
            {p.slice(1, -1)}
          </code>
        ) : (
          <span key={i}>{p}</span>
        ),
      )}
    </>
  );
}

export function QuestionInput({ q, value, onChange }: { q: PublicQuestion; value: unknown; onChange: (v: unknown) => void }) {
  switch (q.type) {
    case "MULTIPLE_CHOICE":
    case "PREDICT_OUTPUT":
      if (q.choices && q.choices.length) {
        const chosen = (value as number[] | undefined) ?? [];
        return (
          <div className="space-y-2">
            {q.choices.map((c) => {
              const on = chosen.includes(c.id);
              return (
                <label key={c.id} className={cn("flex cursor-pointer items-center gap-3 rounded-lg border p-3 text-sm transition-colors", on ? "border-primary bg-primary/10" : "hover:bg-accent/40")}>
                  {q.multiple ? (
                    <Checkbox checked={on} onCheckedChange={() => onChange(on ? chosen.filter((x) => x !== c.id) : [...chosen, c.id])} />
                  ) : (
                    <input type="radio" name={q.id} checked={on} onChange={() => onChange([c.id])} className="accent-[var(--primary)]" />
                  )}
                  <span className={q.type === "PREDICT_OUTPUT" ? "font-mono text-xs" : ""}>
                    <Prompt text={c.text} />
                  </span>
                </label>
              );
            })}
            {q.multiple && <p className="text-xs text-muted-foreground">Select all that apply.</p>}
          </div>
        );
      }
      return <Textarea value={(value as string) ?? ""} onChange={(e) => onChange(e.target.value)} className="font-mono" placeholder="Exact output" />;
    case "TRUE_FALSE":
      return (
        <div className="flex gap-3">
          {[true, false].map((v) => (
            <button key={String(v)} type="button" onClick={() => onChange(v)} className={cn("flex-1 rounded-lg border p-3 text-sm font-medium", value === v ? "border-primary bg-primary/10" : "hover:bg-accent/40")}>
              {v ? "True" : "False"}
            </button>
          ))}
        </div>
      );
    case "FILL_BLANK":
    case "PERMISSION":
      return <Input value={(value as string) ?? ""} onChange={(e) => onChange(e.target.value)} className="max-w-sm font-mono" placeholder={q.type === "PERMISSION" ? "e.g. 644" : (q.placeholder ?? "Your answer")} />;
    case "MATCHING": {
      const sel = (value as (number | null)[] | undefined) ?? q.left!.map(() => null);
      return (
        <div className="space-y-2">
          {q.left!.map((l, i) => (
            <div key={i} className="grid items-center gap-2 sm:grid-cols-2">
              <span className="rounded-lg border bg-muted/40 px-3 py-2 font-mono text-sm">
                <Prompt text={l} />
              </span>
              <NativeSelect
                value={sel[i] ?? ""}
                onChange={(e) => {
                  const next = [...sel];
                  next[i] = e.target.value === "" ? null : Number(e.target.value);
                  onChange(next);
                }}
                className="h-9"
              >
                <option value="">Choose…</option>
                {q.right!.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.text}
                  </option>
                ))}
              </NativeSelect>
            </div>
          ))}
        </div>
      );
    }
    case "PRACTICAL":
      return (
        <div className="space-y-2">
          <p className="text-sm text-muted-foreground">{q.task}</p>
          <Textarea
            value={(value as string) ?? ""}
            onChange={(e) => onChange(e.target.value)}
            rows={6}
            className="bg-[var(--terminal-bg)] font-mono text-sm text-[#d7dde6]"
            placeholder={"mkdir ~/example\necho hello > ~/example/file.txt"}
          />
          <p className="text-xs text-muted-foreground">Your commands run on a fresh machine and the result is checked automatically.</p>
        </div>
      );
  }
  return null;
}

export function QuizRunner({ quiz, canTake }: { quiz: { slug: string; title: string; description: string; questionCount: number; timeLimitSec: number | null; passingScore: number; xpReward: number }; canTake: boolean }) {
  const router = useRouter();
  const [attempt, setAttempt] = useState<Attempt | null>(null);
  const [answers, setAnswers] = useState<Record<string, unknown>>({});
  const [starting, setStarting] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [remaining, setRemaining] = useState<number | null>(null);
  const submittedRef = useRef(false);
  const storageKey = attempt ? `lp-quiz-${attempt.id}` : null;

  useEffect(() => {
    if (!storageKey) return;
    try {
      const saved = window.localStorage.getItem(storageKey);
      if (saved) setAnswers(JSON.parse(saved));
    } catch {
      /* ignore */
    }
  }, [storageKey]);
  useEffect(() => {
    if (!storageKey) return;
    try {
      window.localStorage.setItem(storageKey, JSON.stringify(answers));
    } catch {
      /* ignore */
    }
  }, [answers, storageKey]);

  async function start() {
    setStarting(true);
    try {
      setAttempt(await api<Attempt>(`/api/quizzes/${quiz.slug}/attempts`, { body: {} }));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not start");
    } finally {
      setStarting(false);
    }
  }

  async function submit(auto = false) {
    if (!attempt || submittedRef.current) return;
    if (!auto) {
      const unanswered = attempt.questions.filter((q) => answers[q.id] === undefined || answers[q.id] === "").length;
      if (unanswered && !window.confirm(`${unanswered} question(s) are unanswered. Submit anyway?`)) return;
    }
    submittedRef.current = true;
    setSubmitting(true);
    try {
      const r = await api<{ score: number; passed: boolean; award: { amount: number; awarded: boolean } | null; badges: string[] }>(`/api/quiz-attempts/${attempt.id}/submit`, { body: { answers } });
      try {
        window.localStorage.removeItem(`lp-quiz-${attempt.id}`);
      } catch {
        /* ignore */
      }
      toast[r.passed ? "success" : "info"](`You scored ${r.score}%${r.award?.awarded ? ` · +${r.award.amount} XP` : ""}`);
      for (const b of r.badges) toast.success(`New badge: ${b} 🏅`);
      router.push(`/quizzes/attempts/${attempt.id}`);
      router.refresh();
    } catch (e) {
      submittedRef.current = false;
      toast.error(e instanceof Error ? e.message : "Submit failed");
      setSubmitting(false);
    }
  }

  useEffect(() => {
    if (!attempt?.expiresAt) return;
    const end = new Date(attempt.expiresAt).getTime();
    const tick = () => {
      const left = Math.max(0, Math.round((end - Date.now()) / 1000));
      setRemaining(left);
      if (left === 0) void submit(true);
    };
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attempt?.expiresAt]);

  if (!attempt) {
    return (
      <div className="mx-auto max-w-2xl rounded-2xl border bg-card p-8 text-center">
        <ListChecks className="mx-auto size-10 text-primary" />
        <h1 className="mt-3 text-2xl font-semibold">{quiz.title}</h1>
        <p className="mt-1 text-muted-foreground">{quiz.description}</p>
        <div className="mt-6 grid grid-cols-3 gap-3 text-sm">
          <div className="rounded-lg border p-3">
            <p className="text-lg font-semibold">{quiz.questionCount}</p>
            <p className="text-xs text-muted-foreground">questions</p>
          </div>
          <div className="rounded-lg border p-3">
            <p className="text-lg font-semibold">{quiz.timeLimitSec ? `${Math.round(quiz.timeLimitSec / 60)} min` : "∞"}</p>
            <p className="text-xs text-muted-foreground">time limit</p>
          </div>
          <div className="rounded-lg border p-3">
            <p className="text-lg font-semibold">{quiz.passingScore}%</p>
            <p className="text-xs text-muted-foreground">to pass (+{quiz.xpReward} XP)</p>
          </div>
        </div>
        {canTake ? (
          <Button className="mt-6" size="lg" onClick={start} disabled={starting}>
            {starting ? <Loader2 className="animate-spin" /> : <Play />} Start quiz
          </Button>
        ) : (
          <p className="mt-6 text-sm text-muted-foreground">Quizzes are taken by students. Teachers can manage questions under Teaching → Quizzes.</p>
        )}
      </div>
    );
  }

  const answered = attempt.questions.filter((q) => answers[q.id] !== undefined && answers[q.id] !== "").length;
  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <div className="sticky top-14 z-10 -mx-1 flex items-center justify-between gap-3 rounded-b-xl border-b bg-background/90 px-1 py-3 backdrop-blur">
        <div>
          <h1 className="font-semibold">{quiz.title}</h1>
          <p className="text-xs text-muted-foreground">
            {answered} / {attempt.questions.length} answered
          </p>
        </div>
        {remaining !== null && (
          <span className={cn("flex items-center gap-1.5 rounded-full border px-3 py-1 font-mono text-sm", remaining < 60 && "border-destructive text-destructive")}>
            <Clock className="size-4" />
            {Math.floor(remaining / 60)}:{String(remaining % 60).padStart(2, "0")}
          </span>
        )}
      </div>
      {attempt.questions.map((q, i) => (
        <section key={q.id} className="rounded-xl border bg-card p-5">
          <p className="mb-1 text-xs font-medium text-muted-foreground">
            Question {i + 1} · {TYPE_LABEL[q.type]} · {q.points} pt{q.points > 1 ? "s" : ""}
          </p>
          <h2 className="mb-3 font-medium">
            <Prompt text={q.prompt} />
          </h2>
          {q.command && <pre className="mb-3 overflow-x-auto rounded-lg bg-[var(--terminal-bg)] p-3 font-mono text-sm text-[#d7dde6]">$ {q.command}</pre>}
          <QuestionInput q={q} value={answers[q.id]} onChange={(v) => setAnswers((a) => ({ ...a, [q.id]: v }))} />
        </section>
      ))}
      <div className="flex justify-end pb-10">
        <Button size="lg" onClick={() => submit(false)} disabled={submitting}>
          {submitting ? <Loader2 className="animate-spin" /> : <Send />} Submit answers
        </Button>
      </div>
    </div>
  );
}

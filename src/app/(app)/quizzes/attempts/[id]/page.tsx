import { CheckCircle2, ChevronRight, RotateCcw, XCircle } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { buttonVariants } from "@/components/ui/button";
import { Prompt } from "@/components/quizzes/quiz-runner";
import { formatDate } from "@/lib/format";
import type { QuestionResult } from "@/lib/quiz-grading";
import { cn } from "@/lib/utils";
import { requireUser } from "@/server/auth/session";
import { attemptView } from "@/server/services/quizzes";

export const metadata = { title: "Quiz review" };

function showGiven(given: unknown, q: { choices?: { id: number; text: string }[]; right?: { id: number; text: string }[]; left?: string[] }): string {
  if (given === null || given === undefined || given === "") return "—";
  if (Array.isArray(given) && q.choices) return given.map((g) => q.choices!.find((c) => c.id === g)?.text ?? g).join(", ");
  if (Array.isArray(given) && q.right && q.left) return q.left.map((l, i) => `${l} → ${q.right!.find((r) => r.id === given[i])?.text ?? "?"}`).join("; ");
  if (typeof given === "boolean") return given ? "True" : "False";
  return String(given);
}

export default async function AttemptReviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser();
  let view;
  try {
    view = await attemptView(id, user);
  } catch {
    notFound();
  }
  if (!view.submittedAt) notFound();
  const results = (view.results as unknown as QuestionResult[]) ?? [];
  const byId = new Map(results.map((r) => [r.questionId, r]));
  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <nav className="flex items-center gap-1 text-sm text-muted-foreground">
        <Link href="/quizzes" className="hover:text-foreground">
          Quizzes
        </Link>
        <ChevronRight className="size-3.5" /> Review
      </nav>
      <div className={cn("rounded-2xl border p-6", view.passed ? "border-success/40 bg-success/5" : "border-warning/40 bg-warning/5")}>
        <h1 className="text-2xl font-semibold">{view.quiz.title}</h1>
        <p className="mt-1 text-sm text-muted-foreground">Submitted {formatDate(view.submittedAt, true)}</p>
        <p className="mt-4 text-4xl font-bold">{view.score}%</p>
        <p className="text-sm">{view.passed ? "Passed – well done!" : `Not passed yet (need ${view.quiz.passingScore}%). Review the explanations and try again.`}</p>
        <Link href={`/quizzes/${view.quiz.slug}`} className={cn(buttonVariants({ variant: "outline", size: "sm" }), "mt-4")}>
          <RotateCcw /> Retake quiz
        </Link>
      </div>
      {view.questions.map((q, i) => {
        const r = byId.get(q.id);
        return (
          <section key={q.id} className={cn("rounded-xl border bg-card p-5", r?.correct ? "border-success/30" : "border-destructive/30")}>
            <div className="flex items-start gap-2">
              {r?.correct ? <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-success" /> : <XCircle className="mt-0.5 size-5 shrink-0 text-destructive" />}
              <div className="min-w-0 flex-1">
                <p className="text-xs text-muted-foreground">
                  Question {i + 1} · {r?.earned ?? 0}/{q.points} pts
                </p>
                <h2 className="font-medium">
                  <Prompt text={q.prompt} />
                </h2>
                {"command" in q && q.command && <pre className="mt-2 rounded bg-[var(--terminal-bg)] p-2 font-mono text-xs text-[#d7dde6]">$ {q.command}</pre>}
                <dl className="mt-3 space-y-1 text-sm">
                  <div>
                    <dt className="inline text-muted-foreground">Your answer: </dt>
                    <dd className="inline whitespace-pre-wrap font-mono text-xs">{showGiven(r?.given, q as never)}</dd>
                  </div>
                  {!r?.correct && (
                    <div>
                      <dt className="inline text-muted-foreground">Correct answer: </dt>
                      <dd className="inline font-mono text-xs text-success">{r?.correctAnswer}</dd>
                    </div>
                  )}
                </dl>
                {r?.feedback && r.feedback !== "Not answered" && <pre className="mt-2 whitespace-pre-wrap rounded-lg bg-muted/50 p-2 text-xs">{r.feedback}</pre>}
                {r?.explanation && <p className="mt-2 rounded-lg bg-muted/40 p-2 text-sm text-muted-foreground">💡 {r.explanation}</p>}
              </div>
            </div>
          </section>
        );
      })}
    </div>
  );
}

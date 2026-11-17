import { CheckCircle2, Clock, ListChecks } from "lucide-react";
import Link from "next/link";
import { EmptyState, PageHeader } from "@/components/app/page-header";
import { formatDate } from "@/lib/format";
import { requireUser } from "@/server/auth/session";
import { prisma } from "@/server/db";

export const metadata = { title: "Quizzes" };

export default async function QuizzesPage() {
  const user = await requireUser();
  const sid = user.studentProfile?.id;
  const [quizzes, attempts] = await Promise.all([
    prisma.quiz.findMany({ where: { isPublished: true }, include: { module: { select: { order: true, title: true } }, _count: { select: { questions: true } } }, orderBy: [{ module: { order: "asc" } }, { createdAt: "asc" }] }),
    sid ? prisma.quizAttempt.findMany({ where: { studentId: sid, submittedAt: { not: null } }, orderBy: { submittedAt: "desc" }, include: { quiz: { select: { title: true } } } }) : [],
  ]);
  const best = new Map<string, number>();
  for (const a of attempts) best.set(a.quizId, Math.max(best.get(a.quizId) ?? 0, a.score ?? 0));
  return (
    <>
      <PageHeader icon={<ListChecks className="size-6 text-primary" />} title="Quizzes" description="Multiple choice, matching, permission puzzles, predict-the-output and practical terminal tasks – graded automatically." />
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {quizzes.map((q) => {
          const score = best.get(q.id);
          return (
            <Link key={q.id} href={`/quizzes/${q.slug}`} className="flex flex-col rounded-xl border bg-card p-5 transition-all hover:-translate-y-0.5 hover:border-primary/40">
              <p className="text-xs text-muted-foreground">{q.module?.title ?? "General"}</p>
              <h2 className="mt-1 font-semibold">{q.title}</h2>
              <p className="mt-1 flex-1 text-sm text-muted-foreground">{q.description}</p>
              <div className="mt-4 flex items-center gap-3 text-xs text-muted-foreground">
                <span>{q._count.questions} questions</span>
                {q.timeLimitSec && (
                  <span className="flex items-center gap-1">
                    <Clock className="size-3" />
                    {Math.round(q.timeLimitSec / 60)} min
                  </span>
                )}
                {score !== undefined && (
                  <span className={`ml-auto flex items-center gap-1 font-medium ${score >= q.passingScore ? "text-success" : "text-warning"}`}>
                    <CheckCircle2 className="size-3.5" /> Best {score}%
                  </span>
                )}
              </div>
            </Link>
          );
        })}
      </div>
      {sid && (
        <section className="mt-10">
          <h2 className="mb-3 text-lg font-semibold">Quiz history</h2>
          {attempts.length === 0 ? (
            <EmptyState title="No attempts yet" description="Your completed quizzes will be listed here so you can review your answers." />
          ) : (
            <div className="overflow-hidden rounded-xl border">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 text-xs text-muted-foreground">
                  <tr>
                    <th className="px-4 py-2 text-left font-medium">Quiz</th>
                    <th className="px-4 py-2 text-left font-medium">Date</th>
                    <th className="px-4 py-2 text-left font-medium">Score</th>
                    <th className="px-4 py-2 text-right font-medium" />
                  </tr>
                </thead>
                <tbody>
                  {attempts.map((a) => (
                    <tr key={a.id} className="border-t">
                      <td className="px-4 py-2.5">{a.quiz.title}</td>
                      <td className="px-4 py-2.5 text-muted-foreground">{formatDate(a.submittedAt, true)}</td>
                      <td className={`px-4 py-2.5 font-medium ${a.passed ? "text-success" : "text-warning"}`}>{a.score}%</td>
                      <td className="px-4 py-2.5 text-right">
                        <Link href={`/quizzes/attempts/${a.id}`} className="text-primary hover:underline">
                          Review
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}
    </>
  );
}

import { ClipboardCheck } from "lucide-react";
import Link from "next/link";
import { EmptyState, PageHeader } from "@/components/app/page-header";
import { FeedbackForm } from "@/components/teacher/assignment-form";
import { timeAgo } from "@/lib/format";
import { requireUser } from "@/server/auth/session";
import { prisma } from "@/server/db";
import { studentScope } from "@/server/services/teacher";

export const metadata = { title: "Submissions" };

export default async function SubmissionsPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const user = await requireUser(["TEACHER", "ADMIN"]);
  const { status } = await searchParams;
  const subs = await prisma.exerciseSubmission.findMany({
    where: { student: studentScope(user), ...(status ? { status: status as never } : {}) },
    include: { student: { include: { user: { select: { name: true } } } }, exercise: { select: { title: true } }, assignment: { select: { title: true } } },
    orderBy: { updatedAt: "desc" },
    take: 100,
  });
  return (
    <>
      <PageHeader
        icon={<ClipboardCheck className="size-6 text-primary" />}
        title="Submissions"
        description="Automatically graded exercise attempts. Review the commands students used and leave feedback."
        actions={
          <div className="flex gap-1.5 text-sm">
            {["", "PASSED", "FAILED", "IN_PROGRESS"].map((s) => (
              <Link key={s} href={s ? `?status=${s}` : "?"} className={`rounded-full border px-3 py-1 ${status === s || (!status && !s) ? "border-primary bg-primary/10 text-primary" : ""}`}>
                {s ? s.replace("_", " ").toLowerCase() : "all"}
              </Link>
            ))}
          </div>
        }
      />
      {subs.length === 0 ? (
        <EmptyState icon={<ClipboardCheck />} title="No submissions" />
      ) : (
        <div className="space-y-3">
          {subs.map((s) => {
            const results = (s.results as { description: string; passed: boolean }[]) ?? [];
            return (
              <details key={s.id} className="group rounded-xl border bg-card">
                <summary className="flex cursor-pointer list-none flex-wrap items-center gap-3 p-4">
                  <span className="font-medium">{s.student.user.name}</span>
                  <span className="text-sm text-muted-foreground">{s.exercise.title}</span>
                  {s.assignment && <span className="rounded bg-muted px-1.5 text-xs">{s.assignment.title}</span>}
                  <span className="ml-auto flex items-center gap-3 text-xs">
                    <span className={s.status === "PASSED" ? "text-success" : s.status === "FAILED" ? "text-warning" : "text-muted-foreground"}>
                      {s.status.replace("_", " ").toLowerCase()} · {s.score}%
                    </span>
                    <span className="text-muted-foreground">
                      {s.attempts} checks · {s.hintsUsed} hints · {timeAgo(s.updatedAt)}
                    </span>
                  </span>
                </summary>
                <div className="grid gap-4 border-t p-4 md:grid-cols-2">
                  <div>
                    <p className="mb-1.5 text-sm font-medium">Task results</p>
                    <ul className="space-y-1 text-sm">
                      {results.map((r, i) => (
                        <li key={i} className={r.passed ? "text-success" : "text-destructive"}>
                          {r.passed ? "✔" : "✘"} {r.description}
                        </li>
                      ))}
                      {!results.length && <li className="text-muted-foreground">Not checked yet.</li>}
                    </ul>
                    <p className="mb-1.5 mt-4 text-sm font-medium">Feedback</p>
                    <FeedbackForm id={s.id} initial={s.feedback} />
                  </div>
                  <div>
                    <p className="mb-1.5 text-sm font-medium">Commands used ({s.commandLog.length})</p>
                    <pre className="max-h-64 overflow-auto rounded-lg bg-[var(--terminal-bg)] p-3 font-mono text-xs text-[#d7dde6]">{s.commandLog.length ? s.commandLog.map((c) => `$ ${c}`).join("\n") : "(none recorded)"}</pre>
                  </div>
                </div>
              </details>
            );
          })}
        </div>
      )}
    </>
  );
}

import { ClipboardList } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { DifficultyBadge } from "@/components/app/icons";
import { EmptyState, PageHeader } from "@/components/app/page-header";
import { formatDate } from "@/lib/format";
import { requireUser } from "@/server/auth/session";
import { prisma } from "@/server/db";

export const metadata = { title: "Assignments" };

export default async function AssignmentsPage() {
  const user = await requireUser();
  if (!user.studentProfile) redirect("/teacher/assignments");
  const sid = user.studentProfile.id;
  const list = await prisma.assignment.findMany({
    where: { students: { some: { studentId: sid } } },
    include: { exercise: true, teacher: { include: { user: { select: { name: true } } } }, submissions: { where: { studentId: sid } } },
    orderBy: [{ dueAt: "asc" }, { createdAt: "desc" }],
  });
  return (
    <>
      <PageHeader icon={<ClipboardList className="size-6 text-primary" />} title="Assignments" description="Exercises your teacher assigned to you." />
      {list.length === 0 ? (
        <EmptyState icon={<ClipboardList />} title="No assignments" description="When your teacher assigns exercises they will appear here. Join a class in Settings using your teacher's invite code." />
      ) : (
        <div className="space-y-3">
          {list.map((a) => {
            const sub = a.submissions[0];
            const overdue = a.dueAt && a.dueAt < new Date() && sub?.status !== "PASSED";
            return (
              <Link key={a.id} href={`/challenges/${a.exercise.slug}`} className="flex flex-col gap-2 rounded-xl border bg-card p-5 hover:border-primary/40 sm:flex-row sm:items-center">
                <div className="min-w-0 flex-1">
                  <p className="font-semibold">{a.title}</p>
                  <p className="text-sm text-muted-foreground">
                    {a.exercise.title} · from {a.teacher.user.name}
                  </p>
                  {a.instructions && <p className="mt-1 text-sm">{a.instructions}</p>}
                  {sub?.feedback && <p className="mt-2 rounded-lg bg-muted/50 p-2 text-sm">💬 Teacher feedback: {sub.feedback}</p>}
                </div>
                <div className="flex shrink-0 flex-col items-start gap-1 sm:items-end">
                  <DifficultyBadge difficulty={a.exercise.difficulty} />
                  <span className={`text-sm font-medium ${sub?.status === "PASSED" ? "text-success" : overdue ? "text-destructive" : "text-muted-foreground"}`}>
                    {sub?.status === "PASSED" ? `Completed · ${sub.score}%` : overdue ? "Overdue" : sub ? `In progress · ${sub.score}%` : "Not started"}
                  </span>
                  {a.dueAt && <span className="text-xs text-muted-foreground">Due {formatDate(a.dueAt, true)}</span>}
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </>
  );
}

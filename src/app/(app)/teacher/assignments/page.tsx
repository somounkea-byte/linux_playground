import { ClipboardList } from "lucide-react";
import { DifficultyBadge } from "@/components/app/icons";
import { EmptyState, PageHeader, ProgressBar } from "@/components/app/page-header";
import { DeleteAssignmentButton, NewAssignmentButton } from "@/components/teacher/assignment-form";
import { formatDate } from "@/lib/format";
import { requireUser } from "@/server/auth/session";
import { prisma } from "@/server/db";
import { studentScope } from "@/server/services/teacher";

export const metadata = { title: "Assignments" };

export default async function TeacherAssignmentsPage() {
  const user = await requireUser(["TEACHER", "ADMIN"]);
  const [assignments, exercises, students] = await Promise.all([
    prisma.assignment.findMany({
      where: user.role === "ADMIN" ? {} : { teacherId: user.teacherProfile?.id ?? "-" },
      include: { exercise: true, students: true, submissions: { select: { status: true } }, teacher: { include: { user: { select: { name: true } } } } },
      orderBy: { createdAt: "desc" },
    }),
    prisma.exercise.findMany({ where: { isPublished: true }, orderBy: { title: "asc" }, select: { id: true, title: true, difficulty: true, xpReward: true } }),
    prisma.studentProfile.findMany({ where: studentScope(user), include: { user: { select: { name: true } } }, orderBy: { user: { name: "asc" } } }),
  ]);
  return (
    <>
      <PageHeader
        icon={<ClipboardList className="size-6 text-primary" />}
        title="Assignments"
        description="Assign exercises to your class with deadlines. Progress updates automatically as students check their work."
        actions={user.teacherProfile && <NewAssignmentButton exercises={exercises} students={students.map((s) => ({ id: s.id, name: s.user.name }))} />}
      />
      {assignments.length === 0 ? (
        <EmptyState icon={<ClipboardList />} title="No assignments yet" description="Create one to give your students a graded lab." />
      ) : (
        <div className="space-y-3">
          {assignments.map((a) => {
            const done = a.submissions.filter((s) => s.status === "PASSED").length;
            const pct = a.students.length ? (done / a.students.length) * 100 : 0;
            return (
              <div key={a.id} className="flex flex-col gap-3 rounded-xl border bg-card p-5 md:flex-row md:items-center">
                <div className="min-w-0 flex-1">
                  <p className="font-semibold">{a.title}</p>
                  <p className="text-sm text-muted-foreground">
                    {a.exercise.title} · {a.students.length} students{user.role === "ADMIN" ? ` · ${a.teacher.user.name}` : ""}
                  </p>
                  <div className="mt-1 flex items-center gap-2">
                    <DifficultyBadge difficulty={a.exercise.difficulty} />
                    <span className={`text-xs ${a.dueAt && a.dueAt < new Date() ? "text-destructive" : "text-muted-foreground"}`}>{a.dueAt ? `Due ${formatDate(a.dueAt, true)}` : "No deadline"}</span>
                  </div>
                </div>
                <div className="w-full md:w-56">
                  <div className="mb-1 flex justify-between text-xs text-muted-foreground">
                    <span>Completed</span>
                    <span>
                      {done}/{a.students.length}
                    </span>
                  </div>
                  <ProgressBar value={pct} tone="success" />
                </div>
                <DeleteAssignmentButton id={a.id} />
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}

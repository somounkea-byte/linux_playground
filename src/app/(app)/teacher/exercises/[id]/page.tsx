import { notFound } from "next/navigation";
import { PageHeader } from "@/components/app/page-header";
import { ExerciseEditor, type ExerciseFormValue } from "@/components/teacher/exercise-editor";
import { CHECK_TYPE_LABELS } from "@/lib/linux-engine";
import { requireUser } from "@/server/auth/session";
import { prisma } from "@/server/db";

export const metadata = { title: "Edit exercise" };

export default async function ExerciseEditPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser(["TEACHER", "ADMIN"]);
  const modules = await prisma.learningModule.findMany({ orderBy: { order: "asc" }, select: { slug: true, title: true } });
  let initial: ExerciseFormValue | null = null;
  let readOnly = false;
  if (id !== "new") {
    const ex = await prisma.exercise.findUnique({ where: { id }, include: { tasks: { orderBy: { order: "asc" } } } });
    if (!ex) notFound();
    readOnly = user.role !== "ADMIN" && ex.authorId !== user.id;
    initial = {
      id: ex.id,
      title: ex.title,
      slug: ex.slug,
      kind: ex.kind,
      difficulty: ex.difficulty,
      category: ex.category,
      summary: ex.summary,
      scenario: ex.scenario,
      objectives: ex.objectives,
      instructions: ex.instructions,
      setupScript: ex.setupScript,
      xpReward: ex.xpReward,
      hints: ex.hints,
      solution: ex.solution,
      isPublished: ex.isPublished,
      tasks: ex.tasks.map((t) => ({ description: t.description, hint: t.hint, points: t.points, check: t.check as Record<string, unknown> })),
    };
  }
  return (
    <>
      <PageHeader title={id === "new" ? "New exercise" : readOnly ? initial!.title : `Edit: ${initial!.title}`} description={readOnly ? "Built-in exercises are read-only for teachers. You can still assign them to students." : "Students solve exercises on their own fresh machine. Tasks are checked against the final state."} />
      <ExerciseEditor initial={initial} modules={modules} checkTypes={CHECK_TYPE_LABELS} readOnly={readOnly} />
    </>
  );
}

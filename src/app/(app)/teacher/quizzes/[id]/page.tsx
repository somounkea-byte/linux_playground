import { notFound } from "next/navigation";
import { PageHeader } from "@/components/app/page-header";
import { QuizEditor, type QuizFormValue } from "@/components/teacher/quiz-editor";
import { requireUser } from "@/server/auth/session";
import { prisma } from "@/server/db";

export const metadata = { title: "Edit quiz" };

export default async function QuizEditPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser(["TEACHER", "ADMIN"]);
  const modules = await prisma.learningModule.findMany({ orderBy: { order: "asc" }, select: { id: true, title: true } });
  let initial: QuizFormValue | null = null;
  let readOnly = false;
  if (id !== "new") {
    const q = await prisma.quiz.findUnique({ where: { id }, include: { questions: { orderBy: { order: "asc" } } } });
    if (!q) notFound();
    readOnly = user.role !== "ADMIN" && q.authorId !== user.id;
    initial = {
      id: q.id,
      title: q.title,
      slug: q.slug,
      description: q.description,
      moduleId: q.moduleId,
      timeLimitSec: q.timeLimitSec,
      questionsPerAttempt: q.questionsPerAttempt,
      randomize: q.randomize,
      passingScore: q.passingScore,
      xpReward: q.xpReward,
      isPublished: q.isPublished,
      questions: q.questions.map((x) => ({ id: x.id, type: x.type, prompt: x.prompt, explanation: x.explanation, points: x.points, options: x.options, answer: x.answer })),
    };
  }
  return (
    <>
      <PageHeader title={id === "new" ? "New quiz" : initial!.title} description={readOnly ? "Built-in quizzes are read-only for teachers." : "Answers are stored on the server and never sent to students before grading."} />
      <QuizEditor initial={initial} modules={modules} readOnly={readOnly} />
    </>
  );
}

import { notFound } from "next/navigation";
import { QuizRunner } from "@/components/quizzes/quiz-runner";
import { requireUser } from "@/server/auth/session";
import { prisma } from "@/server/db";

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const q = await prisma.quiz.findUnique({ where: { slug }, select: { title: true } });
  return { title: q?.title ?? "Quiz" };
}

export default async function QuizPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const user = await requireUser();
  const quiz = await prisma.quiz.findUnique({ where: { slug }, include: { _count: { select: { questions: true } } } });
  if (!quiz || !quiz.isPublished) notFound();
  return (
    <QuizRunner
      quiz={{ slug: quiz.slug, title: quiz.title, description: quiz.description, questionCount: quiz.questionsPerAttempt ?? quiz._count.questions, timeLimitSec: quiz.timeLimitSec, passingScore: quiz.passingScore, xpReward: quiz.xpReward }}
      canTake={!!user.studentProfile}
    />
  );
}

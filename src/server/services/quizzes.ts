import "server-only";
import { gradeAttempt, publicQuestion, type StoredQuestion } from "@/lib/quiz-grading";
import type { AuthUser } from "../auth/session";
import { prisma } from "../db";
import { badRequest, conflict, forbidden, notFound } from "../http";
import { awardXp, evaluateBadges, logActivity, recordDailyActivity } from "./gamification";

const GRACE_MS = 30_000;

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function seedOf(attemptId: string, questionId: string) {
  let h = 0;
  for (const c of attemptId + questionId) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return h;
}

export async function startQuizAttempt(user: AuthUser, slug: string) {
  const profile = user.studentProfile;
  if (!profile) throw forbidden("Only students can take quizzes.");
  const quiz = await prisma.quiz.findUnique({ where: { slug }, include: { questions: { orderBy: { order: "asc" } } } });
  if (!quiz || !quiz.isPublished) throw notFound("Quiz");
  if (!quiz.questions.length) throw badRequest("This quiz has no questions yet.");

  // resume an unfinished, unexpired attempt
  const open = await prisma.quizAttempt.findFirst({ where: { quizId: quiz.id, studentId: profile.id, submittedAt: null }, orderBy: { startedAt: "desc" } });
  if (open && (!open.expiresAt || open.expiresAt.getTime() + GRACE_MS > Date.now())) return attemptView(open.id, user);

  let qs = quiz.randomize ? shuffle(quiz.questions) : quiz.questions;
  if (quiz.questionsPerAttempt && quiz.questionsPerAttempt < qs.length) qs = qs.slice(0, quiz.questionsPerAttempt);
  const attempt = await prisma.quizAttempt.create({
    data: {
      quizId: quiz.id,
      studentId: profile.id,
      questionIds: qs.map((q) => q.id),
      totalPoints: qs.reduce((s, q) => s + q.points, 0),
      expiresAt: quiz.timeLimitSec ? new Date(Date.now() + quiz.timeLimitSec * 1000) : null,
    },
  });
  return attemptView(attempt.id, user);
}

export async function attemptView(attemptId: string, user: AuthUser) {
  const attempt = await prisma.quizAttempt.findUnique({ where: { id: attemptId }, include: { quiz: { include: { questions: true } } } });
  if (!attempt) throw notFound("Attempt");
  if (user.role === "STUDENT" && attempt.studentId !== user.studentProfile?.id) throw notFound("Attempt");
  const byId = new Map(attempt.quiz.questions.map((q) => [q.id, q]));
  const questions = attempt.questionIds.map((id) => byId.get(id)).filter(Boolean) as StoredQuestion[];
  return {
    id: attempt.id,
    quiz: { slug: attempt.quiz.slug, title: attempt.quiz.title, passingScore: attempt.quiz.passingScore, timeLimitSec: attempt.quiz.timeLimitSec },
    startedAt: attempt.startedAt,
    expiresAt: attempt.expiresAt,
    submittedAt: attempt.submittedAt,
    score: attempt.score,
    passed: attempt.passed,
    questions: questions.map((q) => publicQuestion(q, seedOf(attempt.id, q.id))),
    results: attempt.submittedAt ? attempt.results : null,
    answers: attempt.submittedAt ? attempt.answers : null,
  };
}

export async function submitQuizAttempt(user: AuthUser, attemptId: string, answers: Record<string, unknown>) {
  const profile = user.studentProfile;
  if (!profile) throw forbidden();
  const attempt = await prisma.quizAttempt.findUnique({ where: { id: attemptId }, include: { quiz: { include: { questions: true } } } });
  if (!attempt || attempt.studentId !== profile.id) throw notFound("Attempt");
  if (attempt.submittedAt) throw conflict("This attempt was already submitted.");
  const late = !!attempt.expiresAt && Date.now() > attempt.expiresAt.getTime() + GRACE_MS;

  const byId = new Map(attempt.quiz.questions.map((q) => [q.id, q]));
  const questions = attempt.questionIds.map((id) => byId.get(id)).filter(Boolean) as StoredQuestion[];
  // only answers for questions in this attempt are considered; late attempts score 0
  const filtered = late ? {} : Object.fromEntries(Object.entries(answers).filter(([k]) => attempt.questionIds.includes(k)));
  const graded = gradeAttempt(questions, filtered, attempt.quiz.passingScore);

  const updated = await prisma.quizAttempt.updateMany({
    where: { id: attempt.id, submittedAt: null },
    data: {
      answers: JSON.parse(JSON.stringify(filtered)),
      results: JSON.parse(JSON.stringify(graded.results)),
      score: graded.score,
      earnedPoints: Math.round(graded.earned),
      passed: graded.passed,
      submittedAt: new Date(),
    },
  });
  if (!updated.count) throw conflict("This attempt was already submitted.");

  await logActivity(profile.id, "QUIZ_COMPLETED", `Scored ${graded.score}% on "${attempt.quiz.title}"`, { quiz: attempt.quiz.slug, score: graded.score, passed: graded.passed });
  let award = null;
  let badges: string[] = [];
  if (graded.passed) {
    award = await awardXp(profile.id, attempt.quiz.xpReward, "quiz", attempt.quiz.id, `Quiz: ${attempt.quiz.title}`);
    badges = await evaluateBadges(profile.id);
  }
  await recordDailyActivity(profile.id);
  return { score: graded.score, passed: graded.passed, late, award, badges };
}

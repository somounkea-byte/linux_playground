import "server-only";
import { prisma } from "../db";
import { modulesWithProgress, recommendedLesson } from "./learning";

export async function studentDashboard(studentId: string) {
  const [profile, modules, recommended, challengesPassed, badges, activities, assignments, quizzes, rank] = await Promise.all([
    prisma.studentProfile.findUniqueOrThrow({ where: { id: studentId }, include: { user: { select: { name: true } } } }),
    modulesWithProgress(studentId),
    recommendedLesson(studentId),
    prisma.exerciseSubmission.count({ where: { studentId, status: "PASSED" } }),
    prisma.studentBadge.findMany({ where: { studentId }, include: { badge: true }, orderBy: { earnedAt: "desc" } }),
    prisma.studentActivity.findMany({ where: { studentId }, orderBy: { createdAt: "desc" }, take: 8 }),
    prisma.assignment.findMany({
      where: { students: { some: { studentId } } },
      include: { exercise: { select: { slug: true, title: true, difficulty: true } }, submissions: { where: { studentId }, select: { status: true } } },
      orderBy: [{ dueAt: "asc" }],
      take: 5,
    }),
    prisma.quizAttempt.count({ where: { studentId, passed: true } }),
    prisma.studentProfile.findUniqueOrThrow({ where: { id: studentId }, select: { xp: true } }).then((p) => prisma.studentProfile.count({ where: { xp: { gt: p.xp } } })),
  ]);
  const totalChallenges = await prisma.exercise.count({ where: { isPublished: true, kind: "CHALLENGE" } });
  return {
    profile,
    modules,
    recommended,
    challengesPassed,
    totalChallenges,
    badges,
    activities,
    assignments: assignments.map((a) => ({ ...a, done: a.submissions[0]?.status === "PASSED" })),
    quizzesPassed: quizzes,
    rank: rank + 1,
    modulesCompleted: modules.filter((m) => m.total > 0 && m.completed === m.total).length,
  };
}

export async function xpHistory(studentId: string, days = 30) {
  const since = new Date(Date.now() - days * 86400000);
  const tx = await prisma.studentXPTransaction.findMany({ where: { studentId, createdAt: { gte: since } }, select: { amount: true, createdAt: true } });
  const byDay = new Map<string, number>();
  for (let i = days - 1; i >= 0; i--) byDay.set(new Date(Date.now() - i * 86400000).toISOString().slice(0, 10), 0);
  for (const t of tx) {
    const d = t.createdAt.toISOString().slice(0, 10);
    if (byDay.has(d)) byDay.set(d, (byDay.get(d) ?? 0) + t.amount);
  }
  return [...byDay.entries()].map(([date, xp]) => ({ date, xp }));
}

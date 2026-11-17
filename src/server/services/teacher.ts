import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import type { AuthUser } from "../auth/session";
import { prisma } from "../db";
import { forbidden, notFound } from "../http";

/** Students visible to a teacher (their class) or to an admin (everyone). */
export function studentScope(user: AuthUser): Prisma.StudentProfileWhereInput {
  if (user.role === "ADMIN") return {};
  if (user.role === "TEACHER" && user.teacherProfile) return { teacherId: user.teacherProfile.id };
  throw forbidden();
}

export async function assertStudentVisible(user: AuthUser, studentId: string) {
  const s = await prisma.studentProfile.findFirst({ where: { id: studentId, ...studentScope(user) }, select: { id: true } });
  if (!s) throw notFound("Student");
}

const DAY = 86400000;

export interface StudentRow {
  id: string;
  userId: string;
  name: string;
  email: string;
  xp: number;
  level: number;
  streak: number;
  lessonsDone: number;
  lessonPercent: number;
  challengesPassed: number;
  avgQuiz: number | null;
  lastActive: Date | null;
  needsSupport: boolean;
  reasons: string[];
}

export async function studentRows(user: AuthUser): Promise<StudentRow[]> {
  const where = studentScope(user);
  const [students, totalLessons] = await Promise.all([
    prisma.studentProfile.findMany({
      where,
      include: {
        user: { select: { name: true, email: true, lastLoginAt: true, isActive: true } },
        _count: { select: { progress: { where: { status: "COMPLETED" } }, submissions: { where: { status: "PASSED" } } } },
      },
      orderBy: { user: { name: "asc" } },
    }),
    prisma.lesson.count({ where: { isPublished: true } }),
  ]);
  const ids = students.map((s) => s.id);
  const [quiz, lastActs] = await Promise.all([
    prisma.quizAttempt.groupBy({ by: ["studentId"], where: { studentId: { in: ids }, submittedAt: { not: null } }, _avg: { score: true } }),
    prisma.studentActivity.groupBy({ by: ["studentId"], where: { studentId: { in: ids } }, _max: { createdAt: true } }),
  ]);
  const quizMap = new Map(quiz.map((q) => [q.studentId, q._avg.score]));
  const actMap = new Map(lastActs.map((a) => [a.studentId, a._max.createdAt]));
  const now = Date.now();
  return students.map((s) => {
    const avgQuiz = quizMap.get(s.id) ?? null;
    const lastActive = [actMap.get(s.id), s.user.lastLoginAt].filter(Boolean).sort((a, b) => b!.getTime() - a!.getTime())[0] ?? null;
    const lessonPercent = totalLessons ? Math.round((s._count.progress / totalLessons) * 100) : 0;
    const reasons: string[] = [];
    if (!lastActive || now - lastActive.getTime() > 7 * DAY) reasons.push("Inactive for 7+ days");
    if (avgQuiz !== null && avgQuiz < 60) reasons.push("Average quiz score below 60%");
    if (lessonPercent < 10 && (!s.createdAt || now - s.createdAt.getTime() > 14 * DAY)) reasons.push("Little progress after 2 weeks");
    return {
      id: s.id,
      userId: s.userId,
      name: s.user.name,
      email: s.user.email,
      xp: s.xp,
      level: s.level,
      streak: s.currentStreak,
      lessonsDone: s._count.progress,
      lessonPercent,
      challengesPassed: s._count.submissions,
      avgQuiz: avgQuiz === null ? null : Math.round(avgQuiz),
      lastActive,
      needsSupport: reasons.length > 0,
      reasons,
    };
  });
}

export async function teacherOverview(user: AuthUser) {
  const rows = await studentRows(user);
  const ids = rows.map((r) => r.id);
  const [challengeCount, modules, exerciseStats, recent] = await Promise.all([
    prisma.exercise.count({ where: { isPublished: true, kind: "CHALLENGE" } }),
    moduleCompletion(ids),
    exercisePerformance(ids),
    prisma.studentActivity.findMany({ where: { studentId: { in: ids } }, orderBy: { createdAt: "desc" }, take: 10, include: { student: { include: { user: { select: { name: true } } } } } }),
  ]);
  const now = Date.now();
  const active = rows.filter((r) => r.lastActive && now - r.lastActive.getTime() < 7 * DAY).length;
  const quizScores = rows.map((r) => r.avgQuiz).filter((x): x is number => x !== null);
  const passed = rows.reduce((a, r) => a + r.challengesPassed, 0);
  return {
    total: rows.length,
    active,
    moduleCompletion: rows.length ? Math.round(rows.reduce((a, r) => a + r.lessonPercent, 0) / rows.length) : 0,
    avgQuiz: quizScores.length ? Math.round(quizScores.reduce((a, b) => a + b, 0) / quizScores.length) : null,
    challengeCompletion: rows.length && challengeCount ? Math.round((passed / (rows.length * challengeCount)) * 100) : 0,
    needSupport: rows.filter((r) => r.needsSupport),
    modules,
    exercises: exerciseStats,
    recent,
    top: [...rows].sort((a, b) => b.xp - a.xp).slice(0, 5),
  };
}

export async function moduleCompletion(studentIds: string[]) {
  const modules = await prisma.learningModule.findMany({ where: { isPublished: true }, orderBy: { order: "asc" }, include: { lessons: { where: { isPublished: true }, select: { id: true } } } });
  const progress = await prisma.studentProgress.groupBy({ by: ["lessonId"], where: { studentId: { in: studentIds }, status: "COMPLETED" }, _count: true });
  const byLesson = new Map(progress.map((p) => [p.lessonId, p._count]));
  return modules.map((m) => {
    const done = m.lessons.reduce((a, l) => a + (byLesson.get(l.id) ?? 0), 0);
    const possible = m.lessons.length * studentIds.length;
    return { slug: m.slug, title: m.title, completion: possible ? Math.round((done / possible) * 100) : 0 };
  });
}

export async function exercisePerformance(studentIds: string[]) {
  const exercises = await prisma.exercise.findMany({ where: { isPublished: true }, orderBy: [{ difficulty: "asc" }, { title: "asc" }], select: { id: true, title: true, slug: true, difficulty: true, kind: true } });
  const subs = await prisma.exerciseSubmission.findMany({ where: { studentId: { in: studentIds } }, select: { exerciseId: true, status: true, score: true, attempts: true, hintsUsed: true } });
  return exercises.map((e) => {
    const s = subs.filter((x) => x.exerciseId === e.id);
    const passed = s.filter((x) => x.status === "PASSED").length;
    return {
      ...e,
      attempted: s.length,
      passed,
      passRate: s.length ? Math.round((passed / s.length) * 100) : 0,
      avgScore: s.length ? Math.round(s.reduce((a, x) => a + x.score, 0) / s.length) : 0,
      avgChecks: s.length ? Math.round((s.reduce((a, x) => a + x.attempts, 0) / s.length) * 10) / 10 : 0,
      avgHints: s.length ? Math.round((s.reduce((a, x) => a + x.hintsUsed, 0) / s.length) * 10) / 10 : 0,
    };
  });
}

export async function quizPerformance(studentIds: string[]) {
  const quizzes = await prisma.quiz.findMany({ orderBy: { createdAt: "asc" }, select: { id: true, title: true, passingScore: true } });
  const attempts = await prisma.quizAttempt.findMany({ where: { studentId: { in: studentIds }, submittedAt: { not: null } }, select: { quizId: true, score: true, passed: true } });
  return quizzes.map((q) => {
    const a = attempts.filter((x) => x.quizId === q.id);
    return { title: q.title, attempts: a.length, avgScore: a.length ? Math.round(a.reduce((s, x) => s + (x.score ?? 0), 0) / a.length) : 0, passRate: a.length ? Math.round((a.filter((x) => x.passed).length / a.length) * 100) : 0 };
  });
}

function csvCell(v: unknown): string {
  const s = v === null || v === undefined ? "" : v instanceof Date ? v.toISOString() : String(v);
  // neutralise spreadsheet formula injection
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export function toCsv(rows: Record<string, unknown>[]): string {
  if (!rows.length) return "";
  const headers = Object.keys(rows[0]);
  return [headers.join(","), ...rows.map((r) => headers.map((h) => csvCell(r[h])).join(","))].join("\n") + "\n";
}

import "server-only";
import { checksSchema, evaluateChecks } from "@/lib/linux-engine";
import type { AuthUser } from "../auth/session";
import { prisma } from "../db";
import { getPlaygroundId, readEnvironment } from "../environments/store";
import { badRequest, forbidden, notFound } from "../http";
import { awardXp, evaluateBadges, logActivity, recordDailyActivity } from "./gamification";

/** All published modules with lesson counts and the student's completion. */
export async function modulesWithProgress(studentId: string | null) {
  const modules = await prisma.learningModule.findMany({
    where: { isPublished: true },
    orderBy: { order: "asc" },
    include: { lessons: { where: { isPublished: true }, orderBy: { order: "asc" }, select: { id: true, slug: true, title: true, estimatedMinutes: true } } },
  });
  const done = studentId
    ? new Set((await prisma.studentProgress.findMany({ where: { studentId, status: "COMPLETED" }, select: { lessonId: true } })).map((p) => p.lessonId))
    : new Set<string>();
  return modules.map((m) => {
    const completed = m.lessons.filter((l) => done.has(l.id)).length;
    return { ...m, completed, total: m.lessons.length, percent: m.lessons.length ? Math.round((completed / m.lessons.length) * 100) : 0, lessons: m.lessons.map((l) => ({ ...l, done: done.has(l.id) })) };
  });
}

/** The first lesson the student has not completed yet. */
export async function recommendedLesson(studentId: string) {
  const modules = await modulesWithProgress(studentId);
  for (const m of modules) {
    const next = m.lessons.find((l) => !l.done);
    if (next) return { module: m, lesson: next };
  }
  return null;
}

export async function completeLesson(user: AuthUser, lessonId: string) {
  const profile = user.studentProfile;
  if (!profile) throw forbidden("Only students can complete lessons.");
  const lesson = await prisma.lesson.findUnique({ where: { id: lessonId }, include: { module: true } });
  if (!lesson || !lesson.isPublished) throw notFound("Lesson");

  const checks = checksSchema.safeParse(lesson.checks);
  if (checks.success && checks.data.length) {
    const envId = await getPlaygroundId(user.id, user.name);
    const state = await readEnvironment(envId);
    const results = evaluateChecks(state, checks.data);
    const failed = results.filter((r) => !r.passed);
    if (failed.length) throw badRequest("Complete the practice tasks in the terminal first.", { results });
  }

  const existing = await prisma.studentProgress.findUnique({ where: { studentId_lessonId: { studentId: profile.id, lessonId } } });
  if (existing?.status !== "COMPLETED") {
    await prisma.studentProgress.upsert({
      where: { studentId_lessonId: { studentId: profile.id, lessonId } },
      update: { status: "COMPLETED", completedAt: new Date() },
      create: { studentId: profile.id, lessonId, status: "COMPLETED", completedAt: new Date() },
    });
    await logActivity(profile.id, "LESSON_COMPLETED", `Completed lesson "${lesson.title}"`, { lessonId, module: lesson.module.slug });
  }
  const award = await awardXp(profile.id, lesson.xpReward, "lesson", lesson.id, `Lesson: ${lesson.title}`);
  await recordDailyActivity(profile.id);
  const badges = await evaluateBadges(profile.id);
  return { award, badges };
}

export async function lessonChecks(user: AuthUser, lessonId: string) {
  const lesson = await prisma.lesson.findUnique({ where: { id: lessonId }, select: { checks: true } });
  if (!lesson) throw notFound("Lesson");
  const checks = checksSchema.safeParse(lesson.checks);
  if (!checks.success || !checks.data.length) return [];
  const envId = await getPlaygroundId(user.id, user.name);
  const state = await readEnvironment(envId);
  return evaluateChecks(state, checks.data);
}

export async function markLessonStarted(studentId: string, lessonId: string) {
  await prisma.studentProgress.upsert({
    where: { studentId_lessonId: { studentId, lessonId } },
    update: {},
    create: { studentId, lessonId, status: "IN_PROGRESS" },
  });
}

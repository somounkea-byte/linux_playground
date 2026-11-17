import "server-only";
import { levelFromXp, XP_RULES } from "@/lib/gamification";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "../db";

export interface AwardResult {
  awarded: boolean;
  amount: number;
  xp: number;
  level: number;
  leveledUp: boolean;
}

/**
 * Grant XP exactly once per (student, sourceType, sourceId).
 * The unique constraint on StudentXPTransaction makes this idempotent even
 * under concurrent requests.
 */
export async function awardXp(studentId: string, amount: number, sourceType: string, sourceId: string, reason: string): Promise<AwardResult> {
  try {
    return await prisma.$transaction(async (tx) => {
      await tx.studentXPTransaction.create({ data: { studentId, amount, sourceType, sourceId, reason } });
      const profile = await tx.studentProfile.update({ where: { id: studentId }, data: { xp: { increment: amount } } });
      const level = levelFromXp(profile.xp);
      const leveledUp = level > profile.level;
      if (level !== profile.level) await tx.studentProfile.update({ where: { id: studentId }, data: { level } });
      if (leveledUp) {
        await tx.studentActivity.create({ data: { studentId, type: "LEVEL_UP", title: `Reached level ${level}`, metadata: { level } } });
        await tx.notification.create({ data: { userId: profile.userId, title: `Level up! You are now level ${level}`, body: "Keep practising to unlock new achievements.", link: "/progress" } });
      }
      return { awarded: true, amount, xp: profile.xp, level, leveledUp };
    });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      const p = await prisma.studentProfile.findUniqueOrThrow({ where: { id: studentId } });
      return { awarded: false, amount: 0, xp: p.xp, level: p.level, leveledUp: false };
    }
    throw e;
  }
}

function utcDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Update the learning streak and grant the daily activity bonus. */
export async function recordDailyActivity(studentId: string, now = new Date()) {
  const profile = await prisma.studentProfile.findUnique({ where: { id: studentId } });
  if (!profile) return;
  const today = utcDay(now);
  const last = profile.lastActiveDate ? utcDay(profile.lastActiveDate) : null;
  if (last === today) return;
  const yesterday = utcDay(new Date(now.getTime() - 86400000));
  const streak = last === yesterday ? profile.currentStreak + 1 : 1;
  const updated = await prisma.studentProfile.updateMany({
    where: { id: studentId, OR: [{ lastActiveDate: null }, { lastActiveDate: { not: new Date(today) } }] },
    data: { lastActiveDate: new Date(today), currentStreak: streak, longestStreak: Math.max(profile.longestStreak, streak) },
  });
  if (updated.count) await awardXp(studentId, XP_RULES.daily, "daily", today, "Daily learning activity");
}

export async function logActivity(studentId: string, type: string, title: string, metadata?: Prisma.InputJsonValue) {
  await prisma.studentActivity.create({ data: { studentId, type, title, metadata } });
}

type Criteria =
  | { type: "lessons_completed"; count: number }
  | { type: "module_completed"; module: string }
  | { type: "all_modules" }
  | { type: "challenges_passed"; count: number; difficulty?: string }
  | { type: "distinct_commands"; count: number }
  | { type: "commands_run"; count: number }
  | { type: "quizzes_passed"; count: number }
  | { type: "level"; level: number }
  | { type: "streak"; days: number };

/** Award any badges whose criteria are now met. Returns newly earned badge names. */
export async function evaluateBadges(studentId: string): Promise<string[]> {
  const [profile, badges, earned] = await Promise.all([
    prisma.studentProfile.findUnique({ where: { id: studentId } }),
    prisma.badge.findMany({ orderBy: { order: "asc" } }),
    prisma.studentBadge.findMany({ where: { studentId }, select: { badgeId: true } }),
  ]);
  if (!profile) return [];
  const have = new Set(earned.map((e) => e.badgeId));
  const pending = badges.filter((b) => !have.has(b.id));
  if (!pending.length) return [];

  const [lessonsDone, modules, passedChallenges, quizzesPassed] = await Promise.all([
    prisma.studentProgress.findMany({ where: { studentId, status: "COMPLETED" }, select: { lesson: { select: { moduleId: true } } } }),
    prisma.learningModule.findMany({ where: { isPublished: true }, select: { id: true, slug: true, _count: { select: { lessons: { where: { isPublished: true } } } } } }),
    prisma.exerciseSubmission.findMany({ where: { studentId, status: "PASSED" }, select: { exercise: { select: { difficulty: true } } } }),
    prisma.quizAttempt.findMany({ where: { studentId, passed: true }, distinct: ["quizId"], select: { quizId: true } }),
  ]);
  const doneByModule = new Map<string, number>();
  for (const l of lessonsDone) doneByModule.set(l.lesson.moduleId, (doneByModule.get(l.lesson.moduleId) ?? 0) + 1);
  const moduleDone = (slug: string) => {
    const m = modules.find((x) => x.slug === slug);
    return !!m && m._count.lessons > 0 && (doneByModule.get(m.id) ?? 0) >= m._count.lessons;
  };

  const met = (c: Criteria): boolean => {
    switch (c.type) {
      case "lessons_completed":
        return lessonsDone.length >= c.count;
      case "module_completed":
        return moduleDone(c.module);
      case "all_modules":
        return modules.length > 0 && modules.every((m) => moduleDone(m.slug));
      case "challenges_passed":
        return passedChallenges.filter((p) => !c.difficulty || p.exercise.difficulty === c.difficulty).length >= c.count;
      case "distinct_commands":
        return profile.distinctCommands.length >= c.count;
      case "commands_run":
        return profile.commandsRun >= c.count;
      case "quizzes_passed":
        return quizzesPassed.length >= c.count;
      case "level":
        return profile.level >= c.level;
      case "streak":
        return profile.longestStreak >= c.days;
    }
  };

  const newly: string[] = [];
  for (const b of pending) {
    if (!met(b.criteria as unknown as Criteria)) continue;
    try {
      await prisma.studentBadge.create({ data: { studentId, badgeId: b.id } });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") continue;
      throw e;
    }
    newly.push(b.name);
    await logActivity(studentId, "BADGE_EARNED", `Earned the "${b.name}" badge`, { badge: b.slug });
    await prisma.notification.create({ data: { userId: profile.userId, title: `New badge: ${b.name}`, body: b.description, link: "/achievements" } });
    if (b.xpBonus > 0) await awardXp(studentId, b.xpBonus, "badge", b.id, `Badge: ${b.name}`);
  }
  // a badge XP bonus can unlock a level badge
  if (newly.length) newly.push(...(await evaluateBadges(studentId)));
  return newly;
}

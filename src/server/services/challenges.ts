import "server-only";
import { checkSchema, evaluateChecks, type Check } from "@/lib/linux-engine";
import type { AuthUser } from "../auth/session";
import { prisma } from "../db";
import { getChallengeEnvId, readEnvironment } from "../environments/store";
import { forbidden, notFound } from "../http";
import { awardXp, evaluateBadges, logActivity, recordDailyActivity } from "./gamification";

export const HINT_THRESHOLD_FOR_SOLUTION = 3;

async function loadExercise(slug: string, user: AuthUser) {
  const exercise = await prisma.exercise.findUnique({ where: { slug }, include: { tasks: { orderBy: { order: "asc" } } } });
  if (!exercise || (!exercise.isPublished && user.role === "STUDENT")) throw notFound("Challenge");
  return exercise;
}

/** Active assignment (if any) linking this student to the exercise. */
async function assignmentFor(studentId: string, exerciseId: string) {
  return prisma.assignment.findFirst({ where: { exerciseId, students: { some: { studentId } } }, orderBy: { createdAt: "desc" } });
}

export async function startChallenge(user: AuthUser, slug: string, reset = false) {
  const exercise = await loadExercise(slug, user);
  const envId = await getChallengeEnvId(user.id, exercise, user.name, reset);
  const profile = user.studentProfile;
  if (profile) {
    const assignment = await assignmentFor(profile.id, exercise.id);
    await prisma.exerciseSubmission.upsert({
      where: { exerciseId_studentId: { exerciseId: exercise.id, studentId: profile.id } },
      update: reset ? { commandLog: [], ...(assignment ? { assignmentId: assignment.id } : {}) } : {},
      create: { exerciseId: exercise.id, studentId: profile.id, totalTasks: exercise.tasks.length, assignmentId: assignment?.id },
    });
  }
  return { envId };
}

export async function checkChallenge(user: AuthUser, slug: string) {
  const exercise = await loadExercise(slug, user);
  const envId = await getChallengeEnvId(user.id, exercise, user.name);
  const state = await readEnvironment(envId);
  const checks: Check[] = exercise.tasks.map((t) => {
    const parsed = checkSchema.parse({ ...(t.check as object), id: t.id, description: t.description });
    return parsed;
  });
  const results = evaluateChecks(state, checks);
  const points = exercise.tasks.reduce((a, t) => a + t.points, 0) || 1;
  const earned = exercise.tasks.reduce((a, t, i) => a + (results[i].passed ? t.points : 0), 0);
  const passed = results.every((r) => r.passed);
  const score = Math.round((earned / points) * 100);

  let award = null;
  let badges: string[] = [];
  const profile = user.studentProfile;
  if (profile) {
    const assignment = await assignmentFor(profile.id, exercise.id);
    const prev = await prisma.exerciseSubmission.findUnique({ where: { exerciseId_studentId: { exerciseId: exercise.id, studentId: profile.id } } });
    const alreadyPassed = prev?.status === "PASSED";
    await prisma.exerciseSubmission.upsert({
      where: { exerciseId_studentId: { exerciseId: exercise.id, studentId: profile.id } },
      update: {
        attempts: { increment: 1 },
        results: JSON.parse(JSON.stringify(results)),
        passedTasks: results.filter((r) => r.passed).length,
        totalTasks: results.length,
        lastCheckedAt: new Date(),
        ...(alreadyPassed ? {} : { status: passed ? "PASSED" : "FAILED", score, completedAt: passed ? new Date() : null }),
        ...(assignment ? { assignmentId: assignment.id } : {}),
      },
      create: {
        exerciseId: exercise.id,
        studentId: profile.id,
        assignmentId: assignment?.id,
        attempts: 1,
        results: JSON.parse(JSON.stringify(results)),
        passedTasks: results.filter((r) => r.passed).length,
        totalTasks: results.length,
        status: passed ? "PASSED" : "FAILED",
        score,
        lastCheckedAt: new Date(),
        completedAt: passed ? new Date() : null,
      },
    });
    if (passed) {
      if (!alreadyPassed) await logActivity(profile.id, "CHALLENGE_PASSED", `Solved "${exercise.title}"`, { exercise: exercise.slug, difficulty: exercise.difficulty });
      const xp = assignment?.xpReward ?? exercise.xpReward;
      award = await awardXp(profile.id, xp, "challenge", exercise.id, `${exercise.kind === "CHALLENGE" ? "Challenge" : "Exercise"}: ${exercise.title}`);
      await recordDailyActivity(profile.id);
      badges = await evaluateBadges(profile.id);
    }
  }
  return { results, passed, score, award, badges };
}

export async function revealHint(user: AuthUser, slug: string, index: number) {
  const exercise = await loadExercise(slug, user);
  if (index < 0 || index >= exercise.hints.length) throw notFound("Hint");
  const profile = user.studentProfile;
  if (profile) {
    const sub = await prisma.exerciseSubmission.findUnique({ where: { exerciseId_studentId: { exerciseId: exercise.id, studentId: profile.id } } });
    if (sub && sub.hintsUsed < index + 1) await prisma.exerciseSubmission.update({ where: { id: sub.id }, data: { hintsUsed: index + 1 } });
  }
  return { hint: exercise.hints[index] };
}

export async function getSolution(user: AuthUser, slug: string) {
  const exercise = await loadExercise(slug, user);
  if (user.role !== "STUDENT") return { solution: exercise.solution };
  const profile = user.studentProfile;
  if (!profile) throw forbidden();
  const sub = await prisma.exerciseSubmission.findUnique({ where: { exerciseId_studentId: { exerciseId: exercise.id, studentId: profile.id } } });
  if (!sub || (sub.status !== "PASSED" && sub.attempts < HINT_THRESHOLD_FOR_SOLUTION)) {
    throw forbidden(`The solution unlocks after you solve the challenge or check it ${HINT_THRESHOLD_FOR_SOLUTION} times.`);
  }
  return { solution: exercise.solution };
}

export async function challengeList(studentId: string | null) {
  const exercises = await prisma.exercise.findMany({
    where: { isPublished: true, kind: "CHALLENGE" },
    orderBy: [{ difficulty: "asc" }, { createdAt: "asc" }],
    include: { _count: { select: { tasks: true } } },
  });
  const subs = studentId ? await prisma.exerciseSubmission.findMany({ where: { studentId }, select: { exerciseId: true, status: true, score: true } }) : [];
  const map = new Map(subs.map((s) => [s.exerciseId, s]));
  return exercises.map((e) => ({ ...e, submission: map.get(e.id) ?? null }));
}

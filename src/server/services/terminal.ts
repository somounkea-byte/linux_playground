import "server-only";
import type { ExecResult } from "@/lib/linux-engine";
import type { AuthUser } from "../auth/session";
import { prisma } from "../db";
import { getChallengeEnvId, getPlaygroundId, withEnvironment } from "../environments/store";
import { badRequest, notFound } from "../http";
import { evaluateBadges, recordDailyActivity } from "./gamification";

export type EnvTarget = { kind: "playground" } | { kind: "challenge"; slug: string };

export async function resolveEnvId(user: AuthUser, target: EnvTarget): Promise<{ envId: string; exerciseId?: string }> {
  if (target.kind === "playground") return { envId: await getPlaygroundId(user.id, user.name) };
  const exercise = await prisma.exercise.findUnique({ where: { slug: target.slug }, select: { id: true, setupScript: true, isPublished: true } });
  if (!exercise || (!exercise.isPublished && user.role === "STUDENT")) throw notFound("Challenge");
  return { envId: await getChallengeEnvId(user.id, exercise, user.name), exerciseId: exercise.id };
}

/** Pick the execution timestamp: replays of interactive prompts reuse the original time. */
export function executionTime(clientNow?: number): number {
  const server = Date.now();
  if (clientNow && Math.abs(clientNow - server) < 10 * 60 * 1000) return clientNow;
  return server;
}

export async function executeCommand(user: AuthUser, target: EnvTarget, line: string, inputs: string[], clientNow?: number) {
  if (line.length > 16000) throw badRequest("Command is too long.");
  const now = executionTime(clientNow);
  const { envId, exerciseId } = await resolveEnvId(user, target);
  const result: ExecResult & { incomplete?: boolean } = await withEnvironment(envId, (env) => env.execute(line, { inputs, now }));

  const completed = !result.needsInput && !result.incomplete && line.trim().length > 0;
  if (completed) {
    await prisma.commandLog.create({ data: { environmentId: envId, userId: user.id, command: line.slice(0, 2000), exitCode: result.exitCode } });
    const profile = user.studentProfile;
    if (profile) {
      const fresh = await prisma.studentProfile.findUnique({ where: { id: profile.id }, select: { distinctCommands: true, commandsRun: true } });
      const merged = [...new Set([...(fresh?.distinctCommands ?? []), ...result.commandsUsed])].slice(0, 500);
      await prisma.studentProfile.update({
        where: { id: profile.id },
        data: { commandsRun: { increment: 1 }, distinctCommands: merged },
      });
      await recordDailyActivity(profile.id);
      if (exerciseId) {
        const sub = await prisma.exerciseSubmission.findUnique({ where: { exerciseId_studentId: { exerciseId, studentId: profile.id } }, select: { id: true, commandLog: true } });
        if (sub) await prisma.exerciseSubmission.update({ where: { id: sub.id }, data: { commandLog: [...sub.commandLog, line.slice(0, 500)].slice(-300) } });
      }
      const newCommand = merged.length !== (fresh?.distinctCommands.length ?? 0);
      if (newCommand || (fresh && (fresh.commandsRun + 1) % 25 === 0)) await evaluateBadges(profile.id);
    }
  }
  return { ...result, now, envId };
}

export async function completeLine(user: AuthUser, target: EnvTarget, line: string, cursor: number) {
  const { envId } = await resolveEnvId(user, target);
  return withEnvironment(envId, (env) => env.complete(line, cursor), { persist: false });
}

export async function terminalState(user: AuthUser, target: EnvTarget) {
  const { envId } = await resolveEnvId(user, target);
  return withEnvironment(
    envId,
    (env) => ({
      prompt: env.prompt(),
      history: env.state.session.history.slice(-200),
    }),
    { persist: false },
  );
}

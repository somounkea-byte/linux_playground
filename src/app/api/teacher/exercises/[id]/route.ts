import { buildChallengeState } from "@/lib/linux-engine/setup";
import { audit } from "@/server/audit";
import { prisma } from "@/server/db";
import { body, notFound, route } from "@/server/http";
import { canEditExercise, exerciseInput, saveExercise } from "@/server/services/exercises";

export const GET = route<{ id: string }>({ roles: ["TEACHER", "ADMIN"] }, async ({ params }) => {
  const ex = await prisma.exercise.findUnique({ where: { id: params.id }, include: { tasks: { orderBy: { order: "asc" } } } });
  if (!ex) throw notFound("Exercise");
  return ex;
});

export const PUT = route<{ id: string }>({ roles: ["TEACHER", "ADMIN"] }, async ({ req, user, params, ip }) => {
  await canEditExercise(user, params.id);
  const input = await body(req, exerciseInput);
  const ex = await saveExercise(user, input, params.id);
  await audit(user.id, "exercise.update", { type: "exercise", id: ex.id }, { title: ex.title }, ip);
  return { id: ex.id, slug: ex.slug };
});

export const DELETE = route<{ id: string }>({ roles: ["TEACHER", "ADMIN"] }, async ({ user, params, ip }) => {
  await canEditExercise(user, params.id);
  await prisma.exercise.delete({ where: { id: params.id } });
  await audit(user.id, "exercise.delete", { type: "exercise", id: params.id }, undefined, ip);
  return { ok: true };
});

/** Dry-run a setup script to catch errors before students see them. */
export const POST = route<{ id: string }>({ roles: ["TEACHER", "ADMIN"], rateLimit: { bucket: "setup-test", limit: 20 } }, async ({ req }) => {
  const { setupScript } = (await req.json()) as { setupScript?: string };
  const lines = (setupScript ?? "").split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("#"));
  const state = buildChallengeState("");
  const { LinuxEnvironment } = await import("@/lib/linux-engine");
  const env = new LinuxEnvironment(state);
  return lines.slice(0, 100).map((line) => {
    const r = env.runAsRoot(line);
    return { line, exitCode: r.exitCode, output: r.output.slice(0, 2000) };
  });
});

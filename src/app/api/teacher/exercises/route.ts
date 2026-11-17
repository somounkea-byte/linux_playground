import { audit } from "@/server/audit";
import { prisma } from "@/server/db";
import { body, route } from "@/server/http";
import { exerciseInput, saveExercise } from "@/server/services/exercises";

export const GET = route({ roles: ["TEACHER", "ADMIN"] }, async () =>
  prisma.exercise.findMany({ orderBy: [{ kind: "asc" }, { difficulty: "asc" }, { title: "asc" }], select: { id: true, slug: true, title: true, kind: true, difficulty: true, category: true, xpReward: true, isPublished: true, authorId: true } }),
);

export const POST = route({ roles: ["TEACHER", "ADMIN"] }, async ({ req, user, ip }) => {
  const input = await body(req, exerciseInput);
  const ex = await saveExercise(user, input);
  await audit(user.id, "exercise.create", { type: "exercise", id: ex.id }, { title: ex.title }, ip);
  return { id: ex.id, slug: ex.slug };
});

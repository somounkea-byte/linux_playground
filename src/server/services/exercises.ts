import "server-only";
import { z } from "zod";
import { checkSchema } from "@/lib/linux-engine";
import type { AuthUser } from "../auth/session";
import { prisma } from "../db";
import { badRequest, conflict, forbidden, notFound } from "../http";

export const exerciseInput = z.object({
  title: z.string().trim().min(3).max(120),
  slug: z
    .string()
    .trim()
    .max(80)
    .regex(/^[a-z0-9-]+$/, "Use lowercase letters, digits and dashes")
    .optional()
    .or(z.literal("")),
  kind: z.enum(["CHALLENGE", "EXERCISE"]).default("EXERCISE"),
  difficulty: z.enum(["BEGINNER", "INTERMEDIATE", "ADVANCED"]),
  category: z.string().min(1).max(60),
  summary: z.string().trim().min(3).max(300),
  scenario: z.string().trim().min(3).max(3000),
  objectives: z.array(z.string().trim().min(1).max(200)).max(10).default([]),
  instructions: z.string().trim().min(3).max(10000),
  setupScript: z.string().max(10000).default(""),
  xpReward: z.number().int().min(0).max(1000).default(50),
  hints: z.array(z.string().trim().min(1).max(500)).max(10).default([]),
  solution: z.string().max(10000).default(""),
  isPublished: z.boolean().default(true),
  tasks: z
    .array(
      z.object({
        description: z.string().trim().min(3).max(300),
        hint: z.string().max(500).optional().nullable(),
        points: z.number().int().min(1).max(20).default(1),
        check: z.record(z.string(), z.unknown()),
      }),
    )
    .min(1, "Add at least one task")
    .max(30),
});

export type ExerciseInput = z.infer<typeof exerciseInput>;

function slugify(s: string) {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 70);
}

function validateTasks(tasks: ExerciseInput["tasks"]) {
  return tasks.map((t, i) => {
    const parsed = checkSchema.safeParse({ ...t.check, id: `t${i + 1}`, description: t.description });
    if (!parsed.success) throw badRequest(`Task ${i + 1}: invalid check – ${parsed.error.issues.map((x) => `${x.path.join(".")} ${x.message}`).join("; ")}`);
    const { id: _id, description: _d, ...check } = parsed.data;
    void _id;
    void _d;
    return { description: t.description, hint: t.hint ?? null, points: t.points, check };
  });
}

export async function canEditExercise(user: AuthUser, exerciseId: string) {
  const ex = await prisma.exercise.findUnique({ where: { id: exerciseId }, select: { authorId: true } });
  if (!ex) throw notFound("Exercise");
  if (user.role !== "ADMIN" && ex.authorId !== user.id) throw forbidden("You can only edit exercises you created.");
}

export async function saveExercise(user: AuthUser, input: ExerciseInput, id?: string) {
  const tasks = validateTasks(input.tasks);
  const slug = input.slug || slugify(input.title);
  const clash = await prisma.exercise.findUnique({ where: { slug } });
  if (clash && clash.id !== id) throw conflict(`An exercise with the slug "${slug}" already exists.`);
  const data = {
    slug,
    title: input.title,
    kind: input.kind,
    difficulty: input.difficulty,
    category: input.category,
    summary: input.summary,
    scenario: input.scenario,
    objectives: input.objectives,
    instructions: input.instructions,
    setupScript: input.setupScript,
    xpReward: input.xpReward,
    hints: input.hints,
    solution: input.solution,
    isPublished: input.isPublished,
  };
  return prisma.$transaction(async (tx) => {
    const ex = id ? await tx.exercise.update({ where: { id }, data }) : await tx.exercise.create({ data: { ...data, authorId: user.id } });
    await tx.exerciseTask.deleteMany({ where: { exerciseId: ex.id } });
    await tx.exerciseTask.createMany({ data: tasks.map((t, i) => ({ exerciseId: ex.id, order: i + 1, description: t.description, hint: t.hint, points: t.points, check: t.check })) });
    return ex;
  });
}

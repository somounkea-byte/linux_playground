import "server-only";
import { z } from "zod";
import { questionDefinitionSchema } from "@/lib/quiz-grading";
import type { AuthUser } from "../auth/session";
import { prisma } from "../db";
import { badRequest, conflict, forbidden, notFound } from "../http";

export const quizInput = z.object({
  title: z.string().trim().min(3).max(120),
  slug: z.string().trim().max(80).regex(/^[a-z0-9-]*$/).optional(),
  description: z.string().trim().min(3).max(500),
  moduleId: z.string().max(40).nullable().optional(),
  timeLimitSec: z.number().int().min(30).max(7200).nullable().optional(),
  questionsPerAttempt: z.number().int().min(1).max(100).nullable().optional(),
  randomize: z.boolean().default(true),
  passingScore: z.number().int().min(0).max(100).default(70),
  xpReward: z.number().int().min(0).max(500).default(30),
  isPublished: z.boolean().default(true),
  questions: z
    .array(
      z.object({
        id: z.string().max(40).optional(),
        type: z.string(),
        prompt: z.string().trim().min(3).max(2000),
        explanation: z.string().max(2000).nullable().optional(),
        points: z.number().int().min(1).max(20).default(1),
        options: z.unknown(),
        answer: z.unknown(),
      }),
    )
    .min(1)
    .max(100),
});

export async function canEditQuiz(user: AuthUser, id: string) {
  const q = await prisma.quiz.findUnique({ where: { id }, select: { authorId: true } });
  if (!q) throw notFound("Quiz");
  if (user.role !== "ADMIN" && q.authorId !== user.id) throw forbidden("You can only edit quizzes you created.");
}

export async function saveQuiz(user: AuthUser, input: z.infer<typeof quizInput>, id?: string) {
  const questions = input.questions.map((q, i) => {
    const parsed = questionDefinitionSchema.safeParse({ type: q.type, options: q.options, answer: q.answer });
    if (!parsed.success) throw badRequest(`Question ${i + 1}: ${parsed.error.issues.map((x) => `${x.path.join(".")} ${x.message}`).join("; ")}`);
    return { id: q.id, type: parsed.data.type, options: parsed.data.options, answer: parsed.data.answer, prompt: q.prompt, explanation: q.explanation ?? null, points: q.points, order: i + 1 };
  });
  const slug = input.slug || input.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 70);
  const clash = await prisma.quiz.findUnique({ where: { slug } });
  if (clash && clash.id !== id) throw conflict(`A quiz with the slug "${slug}" exists.`);
  const meta = {
    slug,
    title: input.title,
    description: input.description,
    moduleId: input.moduleId || null,
    timeLimitSec: input.timeLimitSec ?? null,
    questionsPerAttempt: input.questionsPerAttempt ?? null,
    randomize: input.randomize,
    passingScore: input.passingScore,
    xpReward: input.xpReward,
    isPublished: input.isPublished,
  };
  return prisma.$transaction(async (tx) => {
    const quiz = id ? await tx.quiz.update({ where: { id }, data: meta }) : await tx.quiz.create({ data: { ...meta, authorId: user.id } });
    const keep = questions.filter((q) => q.id).map((q) => q.id!);
    await tx.quizQuestion.deleteMany({ where: { quizId: quiz.id, id: { notIn: keep } } });
    for (const q of questions) {
      const data = { type: q.type, prompt: q.prompt, options: q.options as object, answer: q.answer as object, explanation: q.explanation, points: q.points, order: q.order };
      if (q.id && (await tx.quizQuestion.findFirst({ where: { id: q.id, quizId: quiz.id } }))) await tx.quizQuestion.update({ where: { id: q.id }, data });
      else await tx.quizQuestion.create({ data: { ...data, quizId: quiz.id } });
    }
    return quiz;
  });
}

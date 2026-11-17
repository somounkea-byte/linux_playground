import { audit } from "@/server/audit";
import { prisma } from "@/server/db";
import { body, route } from "@/server/http";
import { canEditQuiz, quizInput, saveQuiz } from "@/server/services/quiz-admin";

export const PUT = route<{ id: string }>({ roles: ["TEACHER", "ADMIN"] }, async ({ req, user, params, ip }) => {
  await canEditQuiz(user, params.id);
  const quiz = await saveQuiz(user, await body(req, quizInput), params.id);
  await audit(user.id, "quiz.update", { type: "quiz", id: quiz.id }, undefined, ip);
  return { id: quiz.id };
});

export const DELETE = route<{ id: string }>({ roles: ["TEACHER", "ADMIN"] }, async ({ user, params, ip }) => {
  await canEditQuiz(user, params.id);
  await prisma.quiz.delete({ where: { id: params.id } });
  await audit(user.id, "quiz.delete", { type: "quiz", id: params.id }, undefined, ip);
  return { ok: true };
});

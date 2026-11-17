import { audit } from "@/server/audit";
import { body, route } from "@/server/http";
import { quizInput, saveQuiz } from "@/server/services/quiz-admin";

export const POST = route({ roles: ["TEACHER", "ADMIN"] }, async ({ req, user, ip }) => {
  const quiz = await saveQuiz(user, await body(req, quizInput));
  await audit(user.id, "quiz.create", { type: "quiz", id: quiz.id }, { title: quiz.title }, ip);
  return { id: quiz.id };
});

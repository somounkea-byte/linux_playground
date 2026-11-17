import { z } from "zod";
import { body, route } from "@/server/http";
import { submitQuizAttempt } from "@/server/services/quizzes";

const schema = z.object({ answers: z.record(z.string().max(40), z.unknown()) });

/** Grade an attempt on the server. Scores are never accepted from the client. */
export const POST = route<{ id: string }>({ roles: ["STUDENT"], rateLimit: { bucket: "quiz-submit", limit: 20 } }, async ({ req, user, params }) => {
  const { answers } = await body(req, schema);
  for (const v of Object.values(answers)) if (JSON.stringify(v ?? null).length > 10000) throw new Error("Answer too long");
  return submitQuizAttempt(user, params.id, answers);
});

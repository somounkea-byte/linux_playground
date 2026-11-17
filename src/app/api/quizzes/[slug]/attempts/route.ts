import { route } from "@/server/http";
import { startQuizAttempt } from "@/server/services/quizzes";

/** Start (or resume) an attempt. Questions are returned without answers. */
export const POST = route<{ slug: string }>({ roles: ["STUDENT"], rateLimit: { bucket: "quiz-start", limit: 30 } }, async ({ user, params }) => startQuizAttempt(user, params.slug));

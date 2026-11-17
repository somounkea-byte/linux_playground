import { route } from "@/server/http";
import { attemptView } from "@/server/services/quizzes";

export const GET = route<{ id: string }>({}, async ({ user, params }) => attemptView(params.id, user));

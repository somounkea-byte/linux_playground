import { route } from "@/server/http";
import { completeLesson } from "@/server/services/learning";

export const POST = route<{ id: string }>({ roles: ["STUDENT"], rateLimit: { bucket: "lesson-complete", limit: 60 } }, async ({ user, params }) => completeLesson(user, params.id));

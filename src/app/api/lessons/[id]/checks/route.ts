import { route } from "@/server/http";
import { lessonChecks } from "@/server/services/learning";

/** Evaluate a lesson's practice tasks against the student's playground. */
export const GET = route<{ id: string }>({ rateLimit: { bucket: "lesson-checks", limit: 120 } }, async ({ user, params }) => lessonChecks(user, params.id));

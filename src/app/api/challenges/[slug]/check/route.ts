import { route } from "@/server/http";
import { checkChallenge } from "@/server/services/challenges";

/** Grade the challenge from the current state of the student's challenge machine. */
export const POST = route<{ slug: string }>({ rateLimit: { bucket: "challenge-check", limit: 60 } }, async ({ user, params }) => checkChallenge(user, params.slug));

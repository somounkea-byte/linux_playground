import { z } from "zod";
import { body, route } from "@/server/http";
import { startChallenge } from "@/server/services/challenges";

const schema = z.object({ reset: z.boolean().default(false) });

export const POST = route<{ slug: string }>({ rateLimit: { bucket: "challenge-start", limit: 30 } }, async ({ req, user, params }) => {
  const { reset } = await body(req, schema);
  return startChallenge(user, params.slug, reset);
});

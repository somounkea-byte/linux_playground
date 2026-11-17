import { z } from "zod";
import { body, route } from "@/server/http";
import { targetSchema } from "@/server/schemas";
import { completeLine } from "@/server/services/terminal";

const schema = z.object({ target: targetSchema, line: z.string().max(4000), cursor: z.number().int().min(0).max(4000) });

export const POST = route({ rateLimit: { bucket: "terminal-complete", limit: 300 } }, async ({ req, user }) => {
  const { target, line, cursor } = await body(req, schema);
  return completeLine(user, target, line, Math.min(cursor, line.length));
});

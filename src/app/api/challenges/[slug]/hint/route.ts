import { z } from "zod";
import { body, route } from "@/server/http";
import { revealHint } from "@/server/services/challenges";

const schema = z.object({ index: z.number().int().min(0).max(20) });

export const POST = route<{ slug: string }>({}, async ({ req, user, params }) => {
  const { index } = await body(req, schema);
  return revealHint(user, params.slug, index);
});

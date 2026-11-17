import { z } from "zod";
import { config } from "@/server/config";
import { body, route } from "@/server/http";
import { targetSchema } from "@/server/schemas";
import { executeCommand } from "@/server/services/terminal";

const schema = z.object({
  target: targetSchema,
  line: z.string().max(16000),
  inputs: z.array(z.string().max(4096)).max(20).default([]),
  now: z.number().int().positive().optional(),
});

/** Execute a command line in the user's own virtual Linux environment. */
export const POST = route({ rateLimit: { bucket: "terminal", limit: config().RATE_LIMIT_TERMINAL_PER_MIN } }, async ({ req, user }) => {
  const input = await body(req, schema);
  const res = await executeCommand(user, input.target, input.line, input.inputs, input.now);
  return {
    output: res.output,
    exitCode: res.exitCode,
    prompt: res.prompt,
    needsInput: res.needsInput ?? null,
    incomplete: !!res.incomplete,
    actions: res.actions,
    now: res.now,
    mutated: res.mutated,
  };
});

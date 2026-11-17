import { z } from "zod";
import { audit } from "@/server/audit";
import { resetPlayground } from "@/server/environments/store";
import { body, route } from "@/server/http";
import { targetSchema } from "@/server/schemas";
import { startChallenge } from "@/server/services/challenges";
import { logActivity } from "@/server/services/gamification";

const schema = z.object({ target: targetSchema });

/** Throw away the environment and start again from a fresh Ubuntu machine. */
export const POST = route({ rateLimit: { bucket: "terminal-reset", limit: 10 } }, async ({ req, user, ip }) => {
  const { target } = await body(req, schema);
  if (target.kind === "playground") await resetPlayground(user.id, user.name);
  else await startChallenge(user, target.slug, true);
  if (user.studentProfile) await logActivity(user.studentProfile.id, "ENV_RESET", target.kind === "playground" ? "Reset the playground environment" : `Restarted challenge ${target.slug}`);
  await audit(user.id, "environment.reset", { type: target.kind, id: target.kind === "challenge" ? target.slug : "playground" }, undefined, ip);
  return { ok: true };
});

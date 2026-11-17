import { z } from "zod";
import { audit } from "@/server/audit";
import { body, route } from "@/server/http";
import { getSettings, updateSettings } from "@/server/services/settings";

export const GET = route({ roles: ["ADMIN"] }, async () => getSettings());

const schema = z.object({ registrationOpen: z.boolean().optional(), maintenanceMessage: z.string().max(300).optional(), defaultTerminalFontSize: z.number().int().min(10).max(24).optional() });

export const PATCH = route({ roles: ["ADMIN"] }, async ({ req, user, ip }) => {
  const patch = await body(req, schema);
  const s = await updateSettings(patch);
  await audit(user.id, "admin.settings_update", undefined, patch, ip);
  return s;
});

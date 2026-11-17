import { audit } from "@/server/audit";
import { prisma } from "@/server/db";
import { body, route } from "@/server/http";
import { lessonPatchSchema as patchSchema } from "@/server/admin-schemas";

export const PATCH = route<{ id: string }>({ roles: ["ADMIN"] }, async ({ req, user, params, ip }) => {
  const input = await body(req, patchSchema);
  await prisma.lesson.update({ where: { id: params.id }, data: input });
  await audit(user.id, "admin.lesson_update", { type: "lesson", id: params.id }, { fields: Object.keys(input) }, ip);
  return { ok: true };
});

export const DELETE = route<{ id: string }>({ roles: ["ADMIN"] }, async ({ user, params, ip }) => {
  await prisma.lesson.delete({ where: { id: params.id } });
  await audit(user.id, "admin.lesson_delete", { type: "lesson", id: params.id }, undefined, ip);
  return { ok: true };
});

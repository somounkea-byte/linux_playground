import { lessonSchema } from "@/server/admin-schemas";
import { audit } from "@/server/audit";
import { prisma } from "@/server/db";
import { body, conflict, route } from "@/server/http";


export const POST = route({ roles: ["ADMIN"] }, async ({ req, user, ip }) => {
  const input = await body(req, lessonSchema);
  if (await prisma.lesson.findUnique({ where: { moduleId_slug: { moduleId: input.moduleId, slug: input.slug } } })) throw conflict("Slug already used in this module");
  const order = ((await prisma.lesson.aggregate({ where: { moduleId: input.moduleId }, _max: { order: true } }))._max.order ?? 0) + 1;
  const l = await prisma.lesson.create({ data: { ...input, order } });
  await audit(user.id, "admin.lesson_create", { type: "lesson", id: l.id }, undefined, ip);
  return { id: l.id };
});

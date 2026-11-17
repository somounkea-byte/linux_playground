import { moduleSchema } from "@/server/admin-schemas";
import { audit } from "@/server/audit";
import { prisma } from "@/server/db";
import { body, conflict, route } from "@/server/http";


export const POST = route({ roles: ["ADMIN"] }, async ({ req, user, ip }) => {
  const input = await body(req, moduleSchema);
  if (await prisma.learningModule.findUnique({ where: { slug: input.slug } })) throw conflict("Slug already used");
  const order = ((await prisma.learningModule.aggregate({ _max: { order: true } }))._max.order ?? 0) + 1;
  const m = await prisma.learningModule.create({ data: { ...input, order } });
  await audit(user.id, "admin.module_create", { type: "module", id: m.id }, undefined, ip);
  return { id: m.id };
});

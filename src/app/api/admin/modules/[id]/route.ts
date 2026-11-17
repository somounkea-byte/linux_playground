import { z } from "zod";
import { audit } from "@/server/audit";
import { prisma } from "@/server/db";
import { body, route } from "@/server/http";

const schema = z.object({
  title: z.string().trim().min(2).max(100).optional(),
  description: z.string().trim().min(2).max(500).optional(),
  icon: z.string().max(40).optional(),
  isPublished: z.boolean().optional(),
  order: z.number().int().min(0).max(1000).optional(),
});

export const PATCH = route<{ id: string }>({ roles: ["ADMIN"] }, async ({ req, user, params, ip }) => {
  const input = await body(req, schema);
  await prisma.learningModule.update({ where: { id: params.id }, data: input });
  await audit(user.id, "admin.module_update", { type: "module", id: params.id }, input, ip);
  return { ok: true };
});

export const DELETE = route<{ id: string }>({ roles: ["ADMIN"] }, async ({ user, params, ip }) => {
  await prisma.learningModule.delete({ where: { id: params.id } });
  await audit(user.id, "admin.module_delete", { type: "module", id: params.id }, undefined, ip);
  return { ok: true };
});

import { z } from "zod";
import { audit } from "@/server/audit";
import { prisma } from "@/server/db";
import { body, forbidden, notFound, route } from "@/server/http";
import type { AuthUser } from "@/server/auth/session";

async function own(user: AuthUser, id: string) {
  const a = await prisma.assignment.findUnique({ where: { id } });
  if (!a) throw notFound("Assignment");
  if (user.role !== "ADMIN" && a.teacherId !== user.teacherProfile?.id) throw forbidden();
  return a;
}

const patch = z.object({ dueAt: z.string().datetime().nullable().optional(), title: z.string().trim().min(3).max(120).optional(), instructions: z.string().max(2000).optional() });

export const PATCH = route<{ id: string }>({ roles: ["TEACHER", "ADMIN"] }, async ({ req, user, params }) => {
  await own(user, params.id);
  const input = await body(req, patch);
  await prisma.assignment.update({ where: { id: params.id }, data: { ...input, dueAt: input.dueAt === undefined ? undefined : input.dueAt ? new Date(input.dueAt) : null } });
  return { ok: true };
});

export const DELETE = route<{ id: string }>({ roles: ["TEACHER", "ADMIN"] }, async ({ user, params, ip }) => {
  await own(user, params.id);
  await prisma.assignment.delete({ where: { id: params.id } });
  await audit(user.id, "assignment.delete", { type: "assignment", id: params.id }, undefined, ip);
  return { ok: true };
});

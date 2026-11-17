import { z } from "zod";
import { audit } from "@/server/audit";
import { hashPassword } from "@/server/auth/password";
import { prisma } from "@/server/db";
import { badRequest, body, notFound, route } from "@/server/http";
import { ensureProfiles } from "@/server/services/users";

const schema = z.object({
  name: z.string().trim().min(2).max(80).optional(),
  role: z.enum(["STUDENT", "TEACHER", "ADMIN"]).optional(),
  isActive: z.boolean().optional(),
  teacherId: z.string().max(40).nullable().optional(),
  password: z.string().min(8).max(200).optional(),
  revokeSessions: z.boolean().optional(),
});

export const PATCH = route<{ id: string }>({ roles: ["ADMIN"] }, async ({ req, user, params, ip }) => {
  const input = await body(req, schema);
  const target = await prisma.user.findUnique({ where: { id: params.id } });
  if (!target) throw notFound("User");
  if (target.id === user.id && (input.role && input.role !== "ADMIN" || input.isActive === false)) throw badRequest("You cannot remove your own admin access.");
  const revoke = input.revokeSessions || input.isActive === false || (input.role && input.role !== target.role) || !!input.password;
  await prisma.user.update({
    where: { id: target.id },
    data: {
      name: input.name,
      role: input.role,
      isActive: input.isActive,
      passwordHash: input.password ? await hashPassword(input.password) : undefined,
      sessionVersion: revoke ? { increment: 1 } : undefined,
    },
  });
  if (input.role) await ensureProfiles(target.id, input.role);
  if (input.teacherId !== undefined) {
    if (input.teacherId && !(await prisma.teacherProfile.findUnique({ where: { id: input.teacherId } }))) throw badRequest("Unknown teacher");
    await prisma.studentProfile.updateMany({ where: { userId: target.id }, data: { teacherId: input.teacherId } });
  }
  await audit(user.id, "admin.user_update", { type: "user", id: target.id }, { ...input, password: input.password ? "***" : undefined }, ip);
  return { ok: true };
});

export const DELETE = route<{ id: string }>({ roles: ["ADMIN"] }, async ({ user, params, ip }) => {
  if (params.id === user.id) throw badRequest("You cannot delete your own account.");
  await prisma.user.delete({ where: { id: params.id } });
  await audit(user.id, "admin.user_delete", { type: "user", id: params.id }, undefined, ip);
  return { ok: true };
});

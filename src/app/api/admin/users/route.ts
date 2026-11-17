import { z } from "zod";
import { audit } from "@/server/audit";
import { hashPassword } from "@/server/auth/password";
import { localAuthEnabled } from "@/server/config";
import { prisma } from "@/server/db";
import { body, conflict, paged, pagination, query, route } from "@/server/http";
import { getPlaygroundId } from "@/server/environments/store";
import { ensureProfiles } from "@/server/services/users";

const listQuery = pagination.extend({ q: z.string().max(100).optional(), role: z.enum(["STUDENT", "TEACHER", "ADMIN"]).optional() });

export const GET = route({ roles: ["ADMIN"] }, async ({ req }) => {
  const { page, pageSize, q, role } = query(req, listQuery);
  const where = { ...(role ? { role } : {}), ...(q ? { OR: [{ name: { contains: q, mode: "insensitive" as const } }, { email: { contains: q, mode: "insensitive" as const } }] } : {}) };
  const [items, total] = await Promise.all([
    prisma.user.findMany({ where, orderBy: { createdAt: "desc" }, skip: (page - 1) * pageSize, take: pageSize, select: { id: true, name: true, email: true, role: true, isActive: true, lastLoginAt: true, createdAt: true } }),
    prisma.user.count({ where }),
  ]);
  return paged(items, total, page, pageSize);
});

const createSchema = z.object({
  name: z.string().trim().min(2).max(80),
  email: z.string().trim().email().max(200),
  role: z.enum(["STUDENT", "TEACHER", "ADMIN"]),
  password: z.string().min(8).max(200).optional(),
  teacherId: z.string().max(40).nullable().optional(),
});

/** Administrators create accounts (teachers, students). With Firebase, users sign in with the same email. */
export const POST = route({ roles: ["ADMIN"] }, async ({ req, user, ip }) => {
  const input = await body(req, createSchema);
  const email = input.email.toLowerCase();
  if (await prisma.user.findUnique({ where: { email } })) throw conflict("A user with this email already exists.");
  const created = await prisma.user.create({
    data: { email, name: input.name, role: input.role, passwordHash: input.password && localAuthEnabled() ? await hashPassword(input.password) : null },
  });
  await ensureProfiles(created.id, created.role);
  if (created.role === "STUDENT") {
    if (input.teacherId) await prisma.studentProfile.update({ where: { userId: created.id }, data: { teacherId: input.teacherId } });
    await getPlaygroundId(created.id, created.name);
  }
  await audit(user.id, "admin.user_create", { type: "user", id: created.id }, { role: created.role }, ip);
  return { id: created.id };
});

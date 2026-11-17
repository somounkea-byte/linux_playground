import { z } from "zod";
import { audit } from "@/server/audit";
import { prisma } from "@/server/db";
import { badRequest, body, route } from "@/server/http";

const schema = z.object({
  name: z.string().trim().min(2).max(80).optional(),
  terminalFontSize: z.number().int().min(10).max(24).optional(),
  inviteCode: z.string().trim().toUpperCase().max(20).optional(),
  leaveClass: z.boolean().optional(),
});

/** Update the signed-in user's own profile. XP, level and role can never be changed here. */
export const PATCH = route({}, async ({ req, user, ip }) => {
  const input = await body(req, schema);
  if (input.name) await prisma.user.update({ where: { id: user.id }, data: { name: input.name } });
  const sp = user.studentProfile;
  if (sp) {
    const data: { terminalFontSize?: number; teacherId?: string | null } = {};
    if (input.terminalFontSize) data.terminalFontSize = input.terminalFontSize;
    if (input.leaveClass) data.teacherId = null;
    if (input.inviteCode) {
      const teacher = await prisma.teacherProfile.findUnique({ where: { inviteCode: input.inviteCode }, include: { user: { select: { name: true } } } });
      if (!teacher) throw badRequest("No class found for that invite code.");
      data.teacherId = teacher.id;
      await prisma.notification.create({ data: { userId: teacher.userId, title: "New student joined your class", body: `${input.name ?? user.name} joined using your invite code.`, link: "/teacher/students" } });
      await audit(user.id, "student.join_class", { type: "teacher", id: teacher.id }, undefined, ip);
    }
    if (Object.keys(data).length) await prisma.studentProfile.update({ where: { id: sp.id }, data });
  }
  return { ok: true };
});

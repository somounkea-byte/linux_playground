import { z } from "zod";
import { audit } from "@/server/audit";
import { prisma } from "@/server/db";
import { badRequest, body, forbidden, notFound, route } from "@/server/http";
import { studentScope } from "@/server/services/teacher";

const schema = z.object({
  exerciseId: z.string().min(1).max(40),
  title: z.string().trim().min(3).max(120),
  instructions: z.string().trim().max(2000).optional(),
  dueAt: z.string().datetime().optional().nullable(),
  xpReward: z.number().int().min(0).max(1000).optional().nullable(),
  studentIds: z.array(z.string().max(40)).max(500).optional(),
  allStudents: z.boolean().default(false),
});

export const POST = route({ roles: ["TEACHER", "ADMIN"] }, async ({ req, user, ip }) => {
  const input = await body(req, schema);
  if (!user.teacherProfile) throw forbidden("Only teachers with a class can create assignments.");
  const ex = await prisma.exercise.findUnique({ where: { id: input.exerciseId } });
  if (!ex) throw notFound("Exercise");
  const visible = await prisma.studentProfile.findMany({ where: studentScope(user), select: { id: true, userId: true } });
  const targets = input.allStudents ? visible : visible.filter((s) => input.studentIds?.includes(s.id));
  if (!targets.length) throw badRequest("Choose at least one student from your class.");
  const a = await prisma.assignment.create({
    data: {
      exerciseId: ex.id,
      teacherId: user.teacherProfile.id,
      title: input.title,
      instructions: input.instructions || null,
      dueAt: input.dueAt ? new Date(input.dueAt) : null,
      xpReward: input.xpReward ?? null,
      students: { create: targets.map((t) => ({ studentId: t.id })) },
    },
  });
  await prisma.notification.createMany({
    data: targets.map((t) => ({ userId: t.userId, title: `New assignment: ${input.title}`, body: input.dueAt ? `Due ${new Date(input.dueAt).toUTCString().slice(0, 16)}` : "Open it from your Assignments page.", link: `/challenges/${ex.slug}` })),
  });
  await audit(user.id, "assignment.create", { type: "assignment", id: a.id }, { students: targets.length }, ip);
  return { id: a.id };
});

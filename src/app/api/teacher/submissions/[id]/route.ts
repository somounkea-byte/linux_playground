import { z } from "zod";
import { audit } from "@/server/audit";
import { prisma } from "@/server/db";
import { body, notFound, route } from "@/server/http";
import { assertStudentVisible } from "@/server/services/teacher";

const schema = z.object({ feedback: z.string().trim().max(3000) });

/** Teachers review a submission and leave feedback (scores stay automatic). */
export const PATCH = route<{ id: string }>({ roles: ["TEACHER", "ADMIN"] }, async ({ req, user, params, ip }) => {
  const sub = await prisma.exerciseSubmission.findUnique({ where: { id: params.id }, include: { student: true, exercise: { select: { title: true, slug: true } } } });
  if (!sub) throw notFound("Submission");
  await assertStudentVisible(user, sub.studentId);
  const { feedback } = await body(req, schema);
  await prisma.exerciseSubmission.update({ where: { id: sub.id }, data: { feedback, reviewedById: user.id, reviewedAt: new Date() } });
  await prisma.notification.create({ data: { userId: sub.student.userId, title: `Feedback on "${sub.exercise.title}"`, body: feedback.slice(0, 200), link: "/assignments" } });
  await audit(user.id, "submission.review", { type: "submission", id: sub.id }, undefined, ip);
  return { ok: true };
});

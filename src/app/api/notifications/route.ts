import { z } from "zod";
import { prisma } from "@/server/db";
import { body, route } from "@/server/http";

export const GET = route({}, async ({ user }) =>
  prisma.notification.findMany({ where: { userId: user.id }, orderBy: { createdAt: "desc" }, take: 30, select: { id: true, title: true, body: true, link: true, readAt: true, createdAt: true } }),
);

const patchSchema = z.object({ ids: z.array(z.string().max(40)).max(100).optional(), all: z.boolean().optional() });

export const PATCH = route({}, async ({ req, user }) => {
  const { ids, all } = await body(req, patchSchema);
  await prisma.notification.updateMany({
    where: { userId: user.id, readAt: null, ...(all ? {} : { id: { in: ids ?? [] } }) },
    data: { readAt: new Date() },
  });
  return { ok: true };
});

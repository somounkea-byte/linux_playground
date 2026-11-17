import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "./db";

export async function audit(
  actorId: string | null,
  action: string,
  target?: { type: string; id: string },
  metadata?: Prisma.InputJsonValue,
  ip?: string | null,
) {
  try {
    await prisma.auditLog.create({
      data: { actorId, action, targetType: target?.type, targetId: target?.id, metadata, ip: ip ?? undefined },
    });
  } catch (e) {
    console.error("[audit] failed to record", action, e);
  }
}

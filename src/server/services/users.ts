import "server-only";
import { randomBytes } from "node:crypto";
import type { Role } from "@/generated/prisma/client";
import { adminEmails } from "../config";
import { prisma } from "../db";
import { getPlaygroundId } from "../environments/store";

export function newInviteCode(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = randomBytes(8);
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("");
}

/** Make sure role-specific profiles exist. */
export async function ensureProfiles(userId: string, role: Role) {
  if (role === "STUDENT") {
    await prisma.studentProfile.upsert({ where: { userId }, update: {}, create: { userId } });
  } else if (role === "TEACHER") {
    const existing = await prisma.teacherProfile.findUnique({ where: { userId } });
    if (!existing) await prisma.teacherProfile.create({ data: { userId, inviteCode: newInviteCode() } });
  }
}

/**
 * Create or update the local user record for an authenticated identity.
 * New accounts are students unless the email is listed in ADMIN_EMAILS.
 */
export async function provisionUser(input: { email: string; name: string; firebaseUid?: string; passwordHash?: string }) {
  const email = input.email.toLowerCase();
  const existing = await prisma.user.findFirst({ where: input.firebaseUid ? { OR: [{ firebaseUid: input.firebaseUid }, { email }] } : { email } });
  if (existing) {
    const user = await prisma.user.update({
      where: { id: existing.id },
      data: { lastLoginAt: new Date(), firebaseUid: existing.firebaseUid ?? input.firebaseUid, ...(adminEmails().includes(email) && existing.role !== "ADMIN" ? { role: "ADMIN" } : {}) },
    });
    await ensureProfiles(user.id, user.role);
    return { user, created: false };
  }
  const role: Role = adminEmails().includes(email) ? "ADMIN" : "STUDENT";
  const user = await prisma.user.create({
    data: { email, name: input.name.slice(0, 100), role, firebaseUid: input.firebaseUid, passwordHash: input.passwordHash, lastLoginAt: new Date() },
  });
  await ensureProfiles(user.id, role);
  if (role === "STUDENT") {
    // every new student gets their own Ubuntu environment immediately
    await getPlaygroundId(user.id, user.name);
    await prisma.notification.create({
      data: { userId: user.id, title: "Welcome to Linux Playground!", body: "Your personal Ubuntu machine is ready. Open the terminal and type `ls` to look around.", link: "/terminal" },
    });
  }
  return { user, created: true };
}

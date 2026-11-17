import "server-only";
import { jwtVerify, SignJWT } from "jose";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import type { Role } from "@/generated/prisma/client";
import { config } from "../config";
import { prisma } from "../db";

export const SESSION_COOKIE = "lp_session";
const SESSION_TTL_SECONDS = 7 * 24 * 3600;

export interface SessionPayload {
  sub: string;
  sv: number;
  role: Role;
}

function key() {
  return new TextEncoder().encode(config().SESSION_SECRET);
}

export async function signSession(payload: SessionPayload): Promise<string> {
  return new SignJWT({ sv: payload.sv, role: payload.role })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(payload.sub)
    .setIssuedAt()
    .setExpirationTime(`${SESSION_TTL_SECONDS}s`)
    .setIssuer("linux-playground")
    .sign(key());
}

export async function verifySession(token: string | undefined): Promise<SessionPayload | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, key(), { issuer: "linux-playground", algorithms: ["HS256"] });
    if (typeof payload.sub !== "string") return null;
    return { sub: payload.sub, sv: Number(payload.sv ?? 0), role: payload.role as Role };
  } catch {
    return null;
  }
}

export function sessionCookieOptions() {
  return {
    httpOnly: true,
    secure: config().APP_URL.startsWith("https://"),
    sameSite: "lax" as const,
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
  };
}

export async function setSessionCookie(payload: SessionPayload) {
  const token = await signSession(payload);
  (await cookies()).set(SESSION_COOKIE, token, sessionCookieOptions());
}

export async function clearSessionCookie() {
  (await cookies()).set(SESSION_COOKIE, "", { ...sessionCookieOptions(), maxAge: 0 });
}

const userInclude = { studentProfile: true, teacherProfile: true } as const;

export type AuthUser = NonNullable<Awaited<ReturnType<typeof loadUser>>>;

async function loadUser(id: string) {
  return prisma.user.findUnique({ where: { id }, include: userInclude });
}

/** The signed-in user for this request (memoised per request). */
export const getCurrentUser = cache(async (): Promise<AuthUser | null> => {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const session = await verifySession(token);
  if (!session) return null;
  const user = await loadUser(session.sub);
  if (!user || !user.isActive || user.sessionVersion !== session.sv) return null;
  return user;
});

/** For server components/pages: redirect when not signed in or role not allowed. */
export async function requireUser(roles?: Role[]): Promise<AuthUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (roles && !roles.includes(user.role)) redirect("/dashboard");
  return user;
}

export function homeFor(role: Role): string {
  if (role === "ADMIN") return "/admin";
  if (role === "TEACHER") return "/teacher";
  return "/dashboard";
}

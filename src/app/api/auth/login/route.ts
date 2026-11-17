import { z } from "zod";
import { verifyPassword } from "@/server/auth/password";
import { homeFor, setSessionCookie } from "@/server/auth/session";
import { audit } from "@/server/audit";
import { localAuthEnabled } from "@/server/config";
import { prisma } from "@/server/db";
import { ApiError, body, forbidden, publicRoute } from "@/server/http";
import { ensureProfiles } from "@/server/services/users";

const schema = z.object({ email: z.string().email().max(200), password: z.string().min(1).max(200) });

/** Email/password login for AUTH_PROVIDER=local (development / self-hosted). */
export const POST = publicRoute({ rateLimit: { bucket: "auth-login" } }, async ({ req, ip }) => {
  if (!localAuthEnabled()) throw forbidden("Password login is disabled. Use Firebase sign-in.");
  const { email, password } = await body(req, schema);
  const user = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });
  const ok = user && user.isActive && (await verifyPassword(password, user.passwordHash));
  if (!ok) {
    await audit(user?.id ?? null, "auth.login_failed", undefined, { email: email.toLowerCase() }, ip);
    throw new ApiError(401, "INVALID_CREDENTIALS", "Incorrect email or password.");
  }
  await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
  await ensureProfiles(user.id, user.role);
  await setSessionCookie({ sub: user.id, sv: user.sessionVersion, role: user.role });
  await audit(user.id, "auth.login", undefined, { provider: "local" }, ip);
  return { redirect: homeFor(user.role) };
});

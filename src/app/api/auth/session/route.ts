import { z } from "zod";
import { verifyFirebaseIdToken } from "@/server/auth/firebase";
import { homeFor, setSessionCookie } from "@/server/auth/session";
import { audit } from "@/server/audit";
import { config } from "@/server/config";
import { prisma } from "@/server/db";
import { ApiError, body, forbidden, publicRoute } from "@/server/http";
import { getSettings } from "@/server/services/settings";
import { provisionUser } from "@/server/services/users";

const schema = z.object({ idToken: z.string().min(20).max(5000), name: z.string().trim().max(80).optional() });

/**
 * Exchange a Firebase ID token (email/password or Google sign-in) for a
 * server session cookie. The token is verified with the Firebase Admin SDK.
 */
export const POST = publicRoute({ rateLimit: { bucket: "auth-session" } }, async ({ req, ip }) => {
  if (config().AUTH_PROVIDER !== "firebase") throw forbidden("Firebase authentication is not enabled.");
  const { idToken, name } = await body(req, schema);
  let identity;
  try {
    identity = await verifyFirebaseIdToken(idToken);
  } catch {
    throw new ApiError(401, "INVALID_TOKEN", "Your sign-in could not be verified. Please try again.");
  }
  const known = await prisma.user.findFirst({ where: { OR: [{ firebaseUid: identity.uid }, { email: identity.email }] } });
  if (!known && !(await getSettings()).registrationOpen) throw forbidden("Registration is currently closed.");
  if (known && !known.isActive) throw forbidden("Your account has been disabled.");
  const { user, created } = await provisionUser({ email: identity.email, name: name || identity.name, firebaseUid: identity.uid });
  await setSessionCookie({ sub: user.id, sv: user.sessionVersion, role: user.role });
  await audit(user.id, created ? "auth.register" : "auth.login", undefined, { provider: identity.provider }, ip);
  return { redirect: homeFor(user.role) };
});

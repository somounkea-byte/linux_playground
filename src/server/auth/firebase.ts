import "server-only";
import { cert, getApps, initializeApp, type App } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { config } from "../config";

let app: App | null = null;

function firebaseApp(): App {
  if (app) return app;
  const c = config();
  if (!c.FIREBASE_PROJECT_ID || !c.FIREBASE_CLIENT_EMAIL || !c.FIREBASE_PRIVATE_KEY) {
    throw new Error("Firebase Admin credentials are not configured (FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY)");
  }
  app =
    getApps()[0] ??
    initializeApp({
      credential: cert({
        projectId: c.FIREBASE_PROJECT_ID,
        clientEmail: c.FIREBASE_CLIENT_EMAIL,
        privateKey: c.FIREBASE_PRIVATE_KEY.replace(/\\n/g, "\n"),
      }),
    });
  return app;
}

export interface VerifiedFirebaseUser {
  uid: string;
  email: string;
  name: string;
  emailVerified: boolean;
  provider: string;
}

/** Verify a Firebase ID token on the server (signature, audience, expiry, revocation). */
export async function verifyFirebaseIdToken(idToken: string): Promise<VerifiedFirebaseUser> {
  const decoded = await getAuth(firebaseApp()).verifyIdToken(idToken, true);
  if (!decoded.email) throw new Error("Firebase account has no email address");
  return {
    uid: decoded.uid,
    email: decoded.email.toLowerCase(),
    name: (decoded.name as string | undefined) ?? decoded.email.split("@")[0],
    emailVerified: !!decoded.email_verified,
    provider: decoded.firebase?.sign_in_provider ?? "password",
  };
}

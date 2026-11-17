import { clearSessionCookie } from "@/server/auth/session";
import { publicRoute } from "@/server/http";

export const POST = publicRoute({}, async () => {
  await clearSessionCookie();
  return { redirect: "/login" };
});

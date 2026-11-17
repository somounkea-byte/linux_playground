import { route } from "@/server/http";
import { targetFromQuery } from "@/server/schemas";
import { terminalState } from "@/server/services/terminal";

/** Current prompt and recent command history of an environment. */
export const GET = route({}, async ({ req, user }) => terminalState(user, targetFromQuery(req.nextUrl.searchParams)));

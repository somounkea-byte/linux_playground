import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import { z, type ZodType } from "zod";
import type { Role } from "@/generated/prisma/client";
import { getCurrentUser, type AuthUser } from "./auth/session";
import { config } from "./config";
import { rateLimit } from "./rate-limit";

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

export const badRequest = (message: string, details?: unknown) => new ApiError(400, "BAD_REQUEST", message, details);
export const unauthorized = () => new ApiError(401, "UNAUTHORIZED", "Please sign in to continue.");
export const forbidden = (message = "You do not have permission to do this.") => new ApiError(403, "FORBIDDEN", message);
export const notFound = (what = "Resource") => new ApiError(404, "NOT_FOUND", `${what} not found.`);
export const conflict = (message: string) => new ApiError(409, "CONFLICT", message);

export function ok<T>(data: T, init?: ResponseInit) {
  return NextResponse.json({ ok: true, data }, init);
}

export function fail(e: ApiError) {
  return NextResponse.json({ ok: false, error: { code: e.code, message: e.message, details: e.details } }, { status: e.status });
}

export function clientIp(req: NextRequest): string {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || "unknown";
}

/** Reject cross-site state-changing requests (defence in depth on top of SameSite cookies). */
function checkOrigin(req: NextRequest) {
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return;
  const origin = req.headers.get("origin");
  if (!origin) return; // non-browser clients (curl, tests) do not send Origin
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  let originHost: string;
  try {
    originHost = new URL(origin).host;
  } catch {
    throw forbidden("Invalid origin.");
  }
  const appHost = new URL(config().APP_URL).host;
  if (originHost !== host && originHost !== appHost) throw forbidden("Cross-site request blocked.");
}

export interface HandlerContext<P> {
  req: NextRequest;
  user: AuthUser;
  params: P;
  ip: string;
}

interface Options {
  roles?: Role[];
  /** Rate limit bucket name and per-minute limit. */
  rateLimit?: { bucket: string; limit?: number };
}

type RouteCtx<P> = { params: Promise<P> };

/** Wrap an authenticated route handler with auth, RBAC, CSRF, rate limiting and error handling. */
export function route<P = Record<string, string>>(opts: Options, fn: (ctx: HandlerContext<P>) => Promise<unknown>) {
  return async (req: NextRequest, rctx: RouteCtx<P>) => {
    try {
      checkOrigin(req);
      const user = await getCurrentUser();
      if (!user) throw unauthorized();
      if (opts.roles && !opts.roles.includes(user.role)) throw forbidden();
      const ip = clientIp(req);
      const limit = opts.rateLimit?.limit ?? config().RATE_LIMIT_API_PER_MIN;
      const rl = await rateLimit(`${opts.rateLimit?.bucket ?? "api"}:${user.id}`, limit);
      if (!rl.allowed) {
        return NextResponse.json(
          { ok: false, error: { code: "RATE_LIMITED", message: "Too many requests. Please slow down." } },
          { status: 429, headers: { "Retry-After": String(rl.resetSeconds) } },
        );
      }
      const params = (rctx?.params ? await rctx.params : {}) as P;
      const result = await fn({ req, user, params, ip });
      if (result instanceof Response) return result;
      return ok(result ?? null);
    } catch (e) {
      return handleError(e);
    }
  };
}

/** Wrap a public route handler (no session required). */
export function publicRoute<P = Record<string, string>>(opts: { rateLimit?: { bucket: string; limit?: number } }, fn: (ctx: { req: NextRequest; params: P; ip: string }) => Promise<unknown>) {
  return async (req: NextRequest, rctx: RouteCtx<P>) => {
    try {
      checkOrigin(req);
      const ip = clientIp(req);
      if (opts.rateLimit) {
        const rl = await rateLimit(`${opts.rateLimit.bucket}:${ip}`, opts.rateLimit.limit ?? config().RATE_LIMIT_AUTH_PER_MIN);
        if (!rl.allowed) {
          return NextResponse.json({ ok: false, error: { code: "RATE_LIMITED", message: "Too many attempts. Please wait a minute." } }, { status: 429 });
        }
      }
      const params = (rctx?.params ? await rctx.params : {}) as P;
      const result = await fn({ req, params, ip });
      if (result instanceof Response) return result;
      return ok(result ?? null);
    } catch (e) {
      return handleError(e);
    }
  };
}

export function handleError(e: unknown) {
  if (e instanceof ApiError) return fail(e);
  if (e instanceof z.ZodError) return fail(badRequest("Invalid request.", e.issues.map((i) => ({ path: i.path.join("."), message: i.message }))));
  console.error("[api] unexpected error", e);
  return fail(new ApiError(500, "INTERNAL", "Something went wrong. Please try again."));
}

/** Parse and validate a JSON body. */
export async function body<T>(req: NextRequest, schema: ZodType<T>): Promise<T> {
  let raw: unknown;
  try {
    const text = await req.text();
    if (text.length > 2 * 1024 * 1024) throw badRequest("Request body too large.");
    raw = text ? JSON.parse(text) : {};
  } catch (e) {
    if (e instanceof ApiError) throw e;
    throw badRequest("Request body must be valid JSON.");
  }
  return schema.parse(raw);
}

export function query<T>(req: NextRequest, schema: ZodType<T>): T {
  return schema.parse(Object.fromEntries(req.nextUrl.searchParams.entries()));
}

export const pagination = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export function paged<T>(items: T[], total: number, page: number, pageSize: number) {
  return { items, total, page, pageSize, pages: Math.max(1, Math.ceil(total / pageSize)) };
}

import "server-only";
import { redis } from "./redis";

const memory = new Map<string, { count: number; reset: number }>();

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetSeconds: number;
}

/** Fixed-window rate limiter backed by Redis, with an in-memory fallback. */
export async function rateLimit(key: string, limit: number, windowSeconds = 60): Promise<RateLimitResult> {
  const r = redis();
  const bucket = `rl:${key}:${Math.floor(Date.now() / 1000 / windowSeconds)}`;
  if (r && r.status === "ready") {
    try {
      const count = await r.incr(bucket);
      if (count === 1) await r.expire(bucket, windowSeconds + 1);
      return { allowed: count <= limit, remaining: Math.max(0, limit - count), resetSeconds: windowSeconds };
    } catch {
      // fall through to memory limiter
    }
  }
  const now = Date.now();
  const entry = memory.get(bucket);
  if (!entry || entry.reset < now) {
    memory.set(bucket, { count: 1, reset: now + windowSeconds * 1000 });
    if (memory.size > 10000) {
      for (const [k, v] of memory) if (v.reset < now) memory.delete(k);
    }
    return { allowed: true, remaining: limit - 1, resetSeconds: windowSeconds };
  }
  entry.count++;
  return { allowed: entry.count <= limit, remaining: Math.max(0, limit - entry.count), resetSeconds: Math.ceil((entry.reset - now) / 1000) };
}

import "server-only";
import Redis from "ioredis";

const globalForRedis = globalThis as unknown as { redis?: Redis | null };

/** Optional Redis client (rate limiting, caching). Returns null when REDIS_URL is not set. */
export function redis(): Redis | null {
  if (globalForRedis.redis !== undefined) return globalForRedis.redis;
  const url = process.env.REDIS_URL;
  if (!url) {
    globalForRedis.redis = null;
    return null;
  }
  const client = new Redis(url, { maxRetriesPerRequest: 1, enableOfflineQueue: false, lazyConnect: false });
  client.on("error", (e) => {
    if (process.env.NODE_ENV !== "test") console.warn("[redis]", e.message);
  });
  globalForRedis.redis = client;
  return client;
}

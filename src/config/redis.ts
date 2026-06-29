import Redis from 'ioredis';
import { env, isProd } from './env.js';

/**
 * Shared Redis client — OPTIONAL by design.
 *
 *  - When REDIS_URL is set, `redis` is an ioredis client.
 *  - When it's unset, `redis` is null and every Redis-backed feature (cache,
 *    league sorted-sets, distributed rate-limit/locks, jobs) falls back to its
 *    SQL/in-memory equivalent. The app therefore runs identically with or
 *    without Redis — Redis only adds scale, never a hard dependency.
 *
 * We cache the client on globalThis in dev so tsx hot-reloads don't leak
 * connections.
 */
const globalForRedis = globalThis as unknown as { redis?: Redis | null };

function create(): Redis | null {
  if (!env.REDIS_URL) return null;
  const client = new Redis(env.REDIS_URL, {
    // Don't crash the process on a transient Redis outage — commands reject and
    // callers fall back. Keep retrying in the background.
    maxRetriesPerRequest: 2,
    enableOfflineQueue: false,
    lazyConnect: false,
    retryStrategy: (times) => Math.min(times * 200, 2000),
  });
  client.on('error', (err) => {
    // Avoid log spam; one line is enough to surface a misconfig.
    if (!isProd) console.warn('[redis] error:', err.message);
  });
  return client;
}

export const redis: Redis | null = globalForRedis.redis ?? create();
if (!isProd) globalForRedis.redis = redis;

/** True when a usable Redis client is configured. */
export const hasRedis = redis != null;

/**
 * Run a Redis-backed operation, returning `fallback()` if Redis is absent or
 * the command fails. Keeps callers free of try/catch and null checks.
 */
export async function withRedis<T>(
  op: (client: Redis) => Promise<T>,
  fallback: () => Promise<T> | T,
): Promise<T> {
  if (!redis) return fallback();
  try {
    return await op(redis);
  } catch {
    return fallback();
  }
}

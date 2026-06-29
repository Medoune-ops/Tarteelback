import { redis, withRedis } from '../config/redis.js';
import { env } from '../config/env.js';

/**
 * Content cache, versioned for instant invalidation.
 *
 * Near-immutable content (sections, sourates, versets, lessons) is cached in
 * Redis. Every cache key embeds a global content version; bumping that version
 * (on any admin write) makes every old key unreachable at once — no need to
 * track/delete individual keys. Falls back to no caching when Redis is absent.
 */
const VERSION_KEY = 'content:version';

/** Current content version (defaults to 0 when unset; an INCR moves it to 1
 *  and changes every cache key, so invalidation works even from a cold key). */
async function version(): Promise<string> {
  return withRedis(
    async (r) => (await r.get(VERSION_KEY)) ?? '0',
    () => '0',
  );
}

/** Invalidate ALL cached content (call after any admin content write). */
export async function bumpContentVersion(): Promise<void> {
  await withRedis(
    async (r) => {
      await r.incr(VERSION_KEY);
    },
    () => undefined,
  );
}

/**
 * Get `key` from cache or compute it via `loader`, storing the JSON result with
 * the content TTL. Transparent no-op (just calls loader) without Redis.
 */
export async function cached<T>(key: string, loader: () => Promise<T>): Promise<T> {
  if (!redis) return loader();
  const v = await version();
  const fullKey = `content:v${v}:${key}`;
  return withRedis(
    async (r) => {
      const hit = await r.get(fullKey);
      if (hit != null) return JSON.parse(hit) as T;
      const value = await loader();
      await r.set(fullKey, JSON.stringify(value), 'EX', env.CONTENT_CACHE_TTL_SECONDS);
      return value;
    },
    loader,
  );
}

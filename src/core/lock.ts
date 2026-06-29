import crypto from 'node:crypto';
import { redis } from '../config/redis.js';
import { prisma } from '../config/prisma.js';

/**
 * Distributed lock for "run this exactly once across all instances" tasks
 * (weekly rollover, scheduled maintenance jobs).
 *
 *  - With Redis: `SET key token NX PX ttl` + a safe token-checked release.
 *  - Without Redis: a Postgres advisory lock (single DB = single coordinator).
 *
 * `withLock` runs `fn` only if the lock is acquired, and always releases it.
 * Returns the fn result, or `null` if the lock was already held by someone else.
 */
export async function withLock<T>(
  name: string,
  ttlMs: number,
  fn: () => Promise<T>,
): Promise<T | null> {
  if (redis) {
    const token = crypto.randomBytes(16).toString('hex');
    const ok = await redis.set(`lock:${name}`, token, 'PX', ttlMs, 'NX');
    if (ok !== 'OK') return null;
    try {
      return await fn();
    } finally {
      // Release only if we still own it (Lua compare-and-delete).
      await redis.eval(
        `if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end`,
        1,
        `lock:${name}`,
        token,
      );
    }
  }

  // Postgres advisory lock fallback. A stable 64-bit key from the name.
  const key = hash64(name);
  const rows = await prisma.$queryRaw<Array<{ locked: boolean }>>`
    SELECT pg_try_advisory_lock(${key}) AS locked`;
  if (!rows[0]?.locked) return null;
  try {
    return await fn();
  } finally {
    await prisma.$queryRaw`SELECT pg_advisory_unlock(${key})`;
  }
}

/** Deterministic signed 64-bit int from a string (for advisory lock keys). */
function hash64(s: string): bigint {
  const h = crypto.createHash('sha256').update(s).digest();
  // Take 8 bytes as a signed BigInt.
  return h.readBigInt64BE(0);
}

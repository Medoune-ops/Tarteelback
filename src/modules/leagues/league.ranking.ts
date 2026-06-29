import { redis, withRedis } from '../../config/redis.js';
import { leagueRepository } from './league.repository.js';

/**
 * League ranking via Redis Sorted Sets, with a SQL fallback.
 *
 * One sorted set per week: key `league:rank:{weekId}`, member = userId,
 * score = weeklyXp. Reads (rank, podium, neighbours) are O(log n) in Redis and
 * scale to millions of members per league. Postgres stays the source of truth
 * (weeklyXp is also incremented there); Redis is a read-optimised projection.
 *
 * When Redis is unavailable every function falls back to the index-backed SQL
 * queries in leagueRepository — so behaviour is identical, just slower at very
 * large scale.
 */

const key = (weekId: string) => `league:rank:${weekId}`;
const TTL_SECONDS = 14 * 24 * 60 * 60; // keep two weeks, then auto-expire

export interface RankedMember {
  userId: string;
  weeklyXp: number;
  rang: number;
}

/** Increment a member's weekly XP in the sorted set (after the DB increment). */
export async function bumpRankXp(weekId: string, userId: string, amount: number): Promise<void> {
  if (!redis || amount === 0) return;
  await withRedis(
    async (r) => {
      await r.zincrby(key(weekId), amount, userId);
      await r.expire(key(weekId), TTL_SECONDS);
    },
    () => undefined,
  );
}

/** Seed/refresh a member's score (e.g. on join). */
export async function setRankXp(weekId: string, userId: string, weeklyXp: number): Promise<void> {
  if (!redis) return;
  await withRedis(
    async (r) => {
      await r.zadd(key(weekId), weeklyXp, userId);
      await r.expire(key(weekId), TTL_SECONDS);
    },
    () => undefined,
  );
}

/**
 * Make sure the Redis sorted set matches the DB for this week. If it's cold or
 * its size differs from the DB (e.g. memberships were created outside the app —
 * seeds, migrations, batch jobs), rebuild it from the DB. This keeps the Redis
 * projection authoritative and self-healing. No-op without Redis.
 */
export async function ensureWarm(weekId: string): Promise<void> {
  if (!redis) return;
  await withRedis(
    async (r) => {
      const [zsize, dbCount] = await Promise.all([
        r.zcard(key(weekId)),
        leagueRepository.countParticipants(weekId),
      ]);
      if (zsize === dbCount) return;
      const members = await leagueRepository.allScores(weekId);
      const pipe = r.multi();
      pipe.del(key(weekId));
      if (members.length > 0) {
        const args: (string | number)[] = [];
        for (const m of members) args.push(m.weeklyXp, m.userId);
        pipe.zadd(key(weekId), ...args);
        pipe.expire(key(weekId), TTL_SECONDS);
      }
      await pipe.exec();
    },
    () => undefined,
  );
}

/** Total participants. */
export async function countMembers(weekId: string): Promise<number> {
  return withRedis(
    async (r) => {
      const n = await r.zcard(key(weekId));
      // If the set is empty (cold cache), fall back to the DB count.
      return n > 0 ? n : leagueRepository.countParticipants(weekId);
    },
    () => leagueRepository.countParticipants(weekId),
  );
}

/** 1-based rank of a user, or null if not a member. */
export async function rankOf(weekId: string, userId: string): Promise<number | null> {
  return withRedis(
    async (r) => {
      const rev = await r.zrevrank(key(weekId), userId);
      if (rev != null) return rev + 1;
      // Cold cache: fall back to SQL (and the caller may warm it later).
      return leagueRepository.rankOf(weekId, userId);
    },
    () => leagueRepository.rankOf(weekId, userId),
  );
}

/** Hydrate userIds → display info from the DB, preserving order. */
async function hydrate(weekId: string, ordered: { userId: string; weeklyXp: number }[]): Promise<
  { userId: string; weeklyXp: number; user: { displayName: string; avatarInitials: string } }[]
> {
  if (ordered.length === 0) return [];
  const rows = await leagueRepository.usersOf(ordered.map((o) => o.userId));
  const byId = new Map(rows.map((u) => [u.id, u]));
  return ordered.map((o) => ({
    userId: o.userId,
    weeklyXp: o.weeklyXp,
    user: {
      displayName: byId.get(o.userId)?.displayName ?? '',
      avatarInitials: byId.get(o.userId)?.avatarInitials ?? '',
    },
  }));
}

type Row = { userId: string; weeklyXp: number; user: { displayName: string; avatarInitials: string } };

/** Top N members (podium). */
export async function top(weekId: string, n: number): Promise<Row[]> {
  return withRedis(
    async (r) => {
      const flat = await r.zrevrange(key(weekId), 0, n - 1, 'WITHSCORES');
      if (flat.length === 0) return sqlTop(weekId, n);
      return hydrate(weekId, parseWithScores(flat));
    },
    () => sqlTop(weekId, n),
  );
}

/** A window of members between two 0-based ranks (inclusive). */
export async function range(weekId: string, startRank0: number, endRank0: number): Promise<Row[]> {
  return withRedis(
    async (r) => {
      const flat = await r.zrevrange(key(weekId), Math.max(0, startRank0), endRank0, 'WITHSCORES');
      if (flat.length === 0) return sqlRange(weekId, startRank0, endRank0);
      return hydrate(weekId, parseWithScores(flat));
    },
    () => sqlRange(weekId, startRank0, endRank0),
  );
}

// ── SQL fallbacks (already O(log n) via the composite index) ──
async function sqlTop(weekId: string, n: number): Promise<Row[]> {
  const rows = await leagueRepository.top(weekId, n);
  return rows.map((m) => ({ userId: m.userId, weeklyXp: m.weeklyXp, user: m.user }));
}
async function sqlRange(weekId: string, startRank0: number, endRank0: number): Promise<Row[]> {
  const rows = await leagueRepository.page(weekId, startRank0, endRank0 - startRank0 + 1);
  return rows.map((m) => ({ userId: m.userId, weeklyXp: m.weeklyXp, user: m.user }));
}

/** ['userId','score',...] → [{userId, weeklyXp}] */
function parseWithScores(flat: string[]): { userId: string; weeklyXp: number }[] {
  const out: { userId: string; weeklyXp: number }[] = [];
  for (let i = 0; i < flat.length; i += 2) {
    out.push({ userId: flat[i]!, weeklyXp: Number(flat[i + 1]) });
  }
  return out;
}

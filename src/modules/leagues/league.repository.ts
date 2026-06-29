import type { Prisma } from '@prisma/client';
import { prisma } from '../../config/prisma.js';

/** Data access for leagues, weeks and memberships. */
export const leagueRepository = {
  /**
   * The user's CURRENT active week — the week they're a member of that is live
   * right now. This correctly handles multiple leagues having an active week
   * simultaneously (a user belongs to exactly one).
   */
  currentWeekForUser(userId: string, now: Date = new Date()) {
    return prisma.leagueWeek.findFirst({
      where: {
        dateDebut: { lte: now },
        dateFin: { gt: now },
        memberships: { some: { userId } },
      },
      orderBy: { dateDebut: 'desc' },
      include: { league: true },
    });
  },

  /** The active week of the lowest league — where a new joiner is placed. */
  lowestActiveWeek(now: Date = new Date()) {
    return prisma.leagueWeek.findFirst({
      where: { dateDebut: { lte: now }, dateFin: { gt: now } },
      orderBy: [{ league: { ordre: 'asc' } }, { dateDebut: 'desc' }],
      include: { league: true },
    });
  },

  lowestLeague() {
    return prisma.league.findFirst({ orderBy: { ordre: 'asc' } });
  },

  membership(userId: string, leagueWeekId: string) {
    return prisma.leagueMembership.findUnique({
      where: { userId_leagueWeekId: { userId, leagueWeekId } },
    });
  },

  joinWeek(userId: string, leagueWeekId: string, weeklyXp: number) {
    return prisma.leagueMembership.upsert({
      where: { userId_leagueWeekId: { userId, leagueWeekId } },
      create: { userId, leagueWeekId, weeklyXp },
      update: {},
    });
  },

  // ── Ranking primitives (O(log n) with the @@index([leagueWeekId, weeklyXp])) ──

  /** Total participants in a week. */
  countParticipants(leagueWeekId: string) {
    return prisma.leagueMembership.count({ where: { leagueWeekId } });
  },

  /**
   * The user's rank = 1 + (number of members strictly above them by weeklyXp,
   * with joinedAt as the tie-breaker). Index-backed COUNT — does not load the
   * whole league.
   */
  async rankOf(leagueWeekId: string, userId: string): Promise<number | null> {
    const me = await prisma.leagueMembership.findUnique({
      where: { userId_leagueWeekId: { userId, leagueWeekId } },
      select: { weeklyXp: true, joinedAt: true },
    });
    if (!me) return null;
    const above = await prisma.leagueMembership.count({
      where: {
        leagueWeekId,
        OR: [
          { weeklyXp: { gt: me.weeklyXp } },
          { weeklyXp: me.weeklyXp, joinedAt: { lt: me.joinedAt } },
        ],
      },
    });
    return above + 1;
  },

  /** Top N of a week (podium), index-ordered, with a LIMIT. */
  top(leagueWeekId: string, take: number) {
    return prisma.leagueMembership.findMany({
      where: { leagueWeekId },
      orderBy: [{ weeklyXp: 'desc' }, { joinedAt: 'asc' }],
      take,
      include: { user: { select: { id: true, displayName: true, avatarInitials: true } } },
    });
  },

  /**
   * A page of members around a given rank (1-based), via OFFSET/LIMIT on the
   * indexed ordering. Loads only `take` rows, never the whole league.
   */
  page(leagueWeekId: string, skip: number, take: number) {
    return prisma.leagueMembership.findMany({
      where: { leagueWeekId },
      orderBy: [{ weeklyXp: 'desc' }, { joinedAt: 'asc' }],
      skip: Math.max(0, skip),
      take,
      include: { user: { select: { id: true, displayName: true, avatarInitials: true } } },
    });
  },

  /** All (userId, weeklyXp) of a week — used to rebuild the Redis sorted set. */
  allScores(leagueWeekId: string) {
    return prisma.leagueMembership.findMany({
      where: { leagueWeekId },
      select: { userId: true, weeklyXp: true },
    });
  },

  /** Fetch display info for a set of users (for Redis-ranked hydration). */
  usersOf(userIds: string[]) {
    return prisma.user.findMany({
      where: { id: { in: userIds } },
      select: { id: true, displayName: true, avatarInitials: true },
    });
  },

  createWeek(data: Prisma.LeagueWeekUncheckedCreateInput) {
    return prisma.leagueWeek.create({ data });
  },

  leagues() {
    return prisma.league.findMany({ orderBy: { ordre: 'asc' } });
  },
};

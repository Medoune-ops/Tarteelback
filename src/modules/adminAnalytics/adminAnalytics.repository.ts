import { prisma } from '../../config/prisma.js';

export const adminAnalyticsRepository = {
  countUsers() {
    return prisma.user.count();
  },

  countUsersCreatedSince(since: Date) {
    return prisma.user.count({ where: { createdAt: { gte: since } } });
  },

  countUsersCreatedBefore(before: Date) {
    return prisma.user.count({ where: { createdAt: { lt: before } } });
  },

  averageStreak() {
    return prisma.user.aggregate({ _avg: { streak: true } });
  },

  /** Distinct users with an ActivityDay row on/after `since` — DAU/WAU proxy. */
  async countDistinctActiveUsersSince(since: Date) {
    const rows = await prisma.activityDay.findMany({
      where: { createdAt: { gte: since } },
      distinct: ['userId'],
      select: { userId: true },
    });
    return rows.length;
  },

  /**
   * Retention proxy: among users created before `cohortCutoff` (so they've
   * had time to lapse), how many have an ActivityDay on/after `activeSince`.
   * Uses two raw counts rather than loading rows, since we only need sizes.
   */
  async countRetainedCohort(cohortCutoff: Date, activeSince: Date) {
    const [cohortSize, retained] = await Promise.all([
      prisma.user.count({ where: { createdAt: { lt: cohortCutoff } } }),
      prisma.user.count({
        where: {
          createdAt: { lt: cohortCutoff },
          activityDays: { some: { createdAt: { gte: activeSince } } },
        },
      }),
    ]);
    return { cohortSize, retained };
  },

  /**
   * Daily signup counts for the last `days` days (including today), bucketed
   * by UTC calendar day. Prisma's groupBy can't date-trunc, so we use a
   * parameterized $queryRaw (tagged template = auto-escaped, no string
   * concatenation of user input — `since`/`days` are plain internal values
   * already validated by Zod upstream).
   */
  async signupsPerDay(since: Date) {
    return prisma.$queryRaw<{ day: Date; count: bigint }[]>`
      SELECT date_trunc('day', "createdAt") AS day, COUNT(*)::bigint AS count
      FROM "User"
      WHERE "createdAt" >= ${since}
      GROUP BY day
      ORDER BY day ASC
    `;
  },

  topStreaks(limit: number) {
    return prisma.user.findMany({
      where: { streak: { gt: 0 } },
      orderBy: { streak: 'desc' },
      take: limit,
      select: {
        id: true,
        displayName: true,
        avatarInitials: true,
        streak: true,
        leagueMemberships: {
          orderBy: { joinedAt: 'desc' },
          take: 1,
          select: { leagueWeek: { select: { league: { select: { nom: true, niveau: true } } } } },
        },
      },
    });
  },
};

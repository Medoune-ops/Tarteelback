import { adminAnalyticsRepository } from './adminAnalytics.repository.js';

const DAY_MS = 24 * 60 * 60 * 1000;

function daysAgo(n: number): Date {
  return new Date(Date.now() - n * DAY_MS);
}

function pctOr(numerator: number, denominator: number): number {
  if (denominator === 0) return 0;
  return Math.round((numerator / denominator) * 100);
}

export const adminAnalyticsService = {
  /**
   * KPIs derivable from real data only:
   * - signups 7j/30j: User.createdAt
   * - DAU/WAU: distinct users with an ActivityDay row in the window (one row
   *   per user per local-day of activity — see schema.prisma)
   * - avgStreak: User.streak average
   * - retention30j: among users created 30j+ ago, % with activity in the
   *   last 7j (a lapsed-cohort-still-coming-back proxy, not a cohort-curve)
   */
  async summary() {
    const [
      totalUsers,
      signups7d,
      signups30d,
      dau,
      wau,
      avgStreakAgg,
      retention,
    ] = await Promise.all([
      adminAnalyticsRepository.countUsers(),
      adminAnalyticsRepository.countUsersCreatedSince(daysAgo(7)),
      adminAnalyticsRepository.countUsersCreatedSince(daysAgo(30)),
      adminAnalyticsRepository.countDistinctActiveUsersSince(daysAgo(1)),
      adminAnalyticsRepository.countDistinctActiveUsersSince(daysAgo(7)),
      adminAnalyticsRepository.averageStreak(),
      adminAnalyticsRepository.countRetainedCohort(daysAgo(30), daysAgo(7)),
    ]);

    return {
      totalUsers,
      signups7d,
      signups30d,
      dau,
      wau,
      avgStreak: Math.round((avgStreakAgg._avg.streak ?? 0) * 10) / 10,
      retention30dPct: pctOr(retention.retained, retention.cohortSize),
    };
  },

  /** One entry per day over the window, zero-filled where no signup occurred. */
  async signupsTimeseries(days: number) {
    const since = daysAgo(days - 1);
    const rows = await adminAnalyticsRepository.signupsPerDay(since);
    const byDay = new Map(rows.map((r) => [r.day.toISOString().slice(0, 10), Number(r.count)]));

    const series: { date: string; count: number }[] = [];
    for (let i = days - 1; i >= 0; i--) {
      const date = new Date(Date.now() - i * DAY_MS).toISOString().slice(0, 10);
      series.push({ date, count: byDay.get(date) ?? 0 });
    }
    return series;
  },

  /** One entry per day over the window, zero-filled where no request occurred. */
  async requestsPerDay(days: number) {
    const since = daysAgo(days - 1);
    const rows = await adminAnalyticsRepository.requestsPerDaySince(since);
    const byDay = new Map(rows.map((r) => [r.day.toISOString().slice(0, 10), r.count]));

    const series: { date: string; count: number }[] = [];
    for (let i = days - 1; i >= 0; i--) {
      const date = new Date(Date.now() - i * DAY_MS).toISOString().slice(0, 10);
      series.push({ date, count: byDay.get(date) ?? 0 });
    }
    return series;
  },

  /** One entry per month over the window, zero-filled where no request occurred. */
  async requestsPerMonth(months: number) {
    const now = new Date();
    const since = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - (months - 1), 1));
    const rows = await adminAnalyticsRepository.requestsPerMonthSince(since);
    const byMonth = new Map(rows.map((r) => [r.month.toISOString().slice(0, 7), Number(r.count)]));

    const series: { month: string; count: number }[] = [];
    for (let i = months - 1; i >= 0; i--) {
      const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
      const month = d.toISOString().slice(0, 7);
      series.push({ month, count: byMonth.get(month) ?? 0 });
    }
    return series;
  },

  async topStreaks(limit: number) {
    const rows = await adminAnalyticsRepository.topStreaks(limit);
    return rows.map((u) => ({
      id: u.id,
      displayName: u.displayName,
      avatarInitials: u.avatarInitials,
      streak: u.streak,
      league: u.leagueMemberships[0]?.leagueWeek.league.nom ?? null,
      leagueTier: u.leagueMemberships[0]?.leagueWeek.league.niveau ?? null,
    }));
  },
};

/**
 * Idempotent maintenance jobs, safe to run from any scheduler (cron, k8s
 * CronJob, a worker). Each takes a distributed lock so only one instance runs
 * it at a time. Designed to be invoked individually or all together.
 *
 *   tsx src/jobs/maintenance.ts                 # run all due jobs
 *   tsx src/jobs/maintenance.ts purge-tokens    # run one
 */
import { prisma } from '../config/prisma.js';
import { withLock } from '../core/lock.js';
import { runWeeklyRollover } from '../modules/leagues/league.cron.js';
import { sendDueDailyReminders, sendDueStreakAlerts } from '../modules/notifications/reminders.js';

const LOCK_TTL_MS = 5 * 60 * 1000;

/** Delete refresh tokens that are expired or were revoked long ago. */
export async function purgeRefreshTokens(now: Date = new Date()) {
  return withLock('job:purge-tokens', LOCK_TTL_MS, async () => {
    const cutoff = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const res = await prisma.refreshToken.deleteMany({
      where: {
        OR: [{ expiresAt: { lt: now } }, { revokedAt: { lt: cutoff } }],
      },
    });
    return { deleted: res.count };
  });
}

/** Flip users whose premium has lapsed back to free (defensive; reads also
 *  recompute this, but a batch job keeps the column truthful for analytics). */
export async function downgradeExpiredPremium(now: Date = new Date()) {
  return withLock('job:downgrade-premium', LOCK_TTL_MS, async () => {
    const res = await prisma.user.updateMany({
      where: { isPremium: true, premiumUntil: { lt: now } },
      data: { isPremium: false },
    });
    return { downgraded: res.count };
  });
}

/** Send all due push reminders (daily learning + streak alerts). */
export async function runReminders(now: Date = new Date()) {
  return withLock('job:reminders', LOCK_TTL_MS, async () => {
    const [daily, streak] = await Promise.all([
      sendDueDailyReminders(now),
      sendDueStreakAlerts(now),
    ]);
    return { daily, streak };
  });
}

/** Run every due maintenance job. Returns a summary. */
export async function runAllMaintenance(now: Date = new Date()) {
  const [tokens, premium, rollover, reminders] = await Promise.all([
    purgeRefreshTokens(now),
    downgradeExpiredPremium(now),
    runWeeklyRollover(now),
    runReminders(now),
  ]);
  return { tokens, premium, rollover, reminders };
}

// CLI entrypoint.
if (import.meta.url === `file://${process.argv[1]}`) {
  const which = process.argv[2];
  const run = async () => {
    switch (which) {
      case 'purge-tokens':
        return purgeRefreshTokens();
      case 'downgrade-premium':
        return downgradeExpiredPremium();
      case 'rollover':
        return runWeeklyRollover();
      case 'reminders':
        return runReminders();
      default:
        return runAllMaintenance();
    }
  };
  run()
    .then((r) => {
      // eslint-disable-next-line no-console
      console.log('Maintenance:', JSON.stringify(r));
      return prisma.$disconnect();
    })
    .catch((e) => {
      // eslint-disable-next-line no-console
      console.error(e);
      process.exit(1);
    });
}

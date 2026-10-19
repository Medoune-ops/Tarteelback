/**
 * Idempotent maintenance jobs, safe to run from any scheduler (cron, k8s
 * CronJob, a worker). Each takes a distributed lock so only one instance runs
 * it at a time. Designed to be invoked individually or all together.
 *
 *   tsx src/jobs/maintenance.ts                 # run all due jobs
 *   tsx src/jobs/maintenance.ts purge-tokens    # run one
 */
import { pathToFileURL } from 'node:url';
import { prisma } from '../config/prisma.js';
import { redis } from '../config/redis.js';
import { withLock } from '../core/lock.js';
import { runWeeklyRollover } from '../modules/leagues/league.cron.js';
import { sendDueInactivityReminders, sendDueStreakAlerts } from '../modules/notifications/reminders.js';
import { householdService } from '../modules/household/household.service.js';
import { drainOutbox as runOutboxDrain, enqueue } from '../core/outbox.js';
import { getLearnedSourates } from '../modules/me/learnedSourates.js';
import { streakLongestConsecutive } from '../core/challengeRules.js';

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

/** Expire les abonnements familiaux échus (+ recompute des membres) et marque
 *  les invitations dépassées. À exécuter avant downgradeExpiredPremium. */
export async function expireHouseholds(now: Date = new Date()) {
  return withLock('job:expire-households', LOCK_TTL_MS, async () => {
    return householdService.expireDue(now);
  });
}

/** Send all due push reminders (streak alerts + inactivity). The daily
 *  learning reminder is a local notification scheduled by the app, not sent
 *  from here. */
export async function runReminders(now: Date = new Date()) {
  return withLock('job:reminders', LOCK_TTL_MS, async () => {
    const [streak, inactivity] = await Promise.all([
      sendDueStreakAlerts(now),
      sendDueInactivityReminders(now),
    ]);
    return { streak, inactivity };
  });
}

/** Drain the transactional outbox (DomainEvent). Runs under lock; 5 attempts max per event. */
export async function processOutbox(now: Date = new Date()) {
  return withLock('job:process-outbox', LOCK_TTL_MS, async () => {
    return runOutboxDrain();
  });
}

/**
 * Passe les défis "pending" dont startsAt est atteint à "active" (si >= 2
 * participants acceptés) ou "cancelled" (sinon). Enregistre la photo de
 * départ (baseline) de chaque participant et passe les "invited" restants à
 * "expired". Idempotent via UPDATE ... WHERE status = 'pending'.
 */
export async function activateChallenges(now: Date = new Date()) {
  return withLock('job:activate-challenges', LOCK_TTL_MS, async () => {
    const pending = await prisma.challenge.findMany({
      where: { status: 'pending', startsAt: { lte: now } },
      include: { participants: true },
    });

    let activated = 0;
    let cancelled = 0;

    for (const challenge of pending) {
      const acceptedCount = challenge.participants.filter(
        (p) => p.status === 'accepted',
      ).length;

      if (acceptedCount >= 2) {
        const updated = await prisma.challenge.update({
          where: { id: challenge.id, status: 'pending' },
          data: { status: 'active' },
        });
        if (!updated) continue; // déjà traité par une autre instance

        // Photo de départ (baseline) de chaque participant + invited → expired.
        for (const p of challenge.participants) {
          let baseline = 0;
          if (challenge.type === 'streak') {
            const days = await prisma.activityDay.findMany({
              where: {
                userId: p.userId,
                day: { gte: challenge.startDay, lte: challenge.endDay },
              },
              select: { day: true },
            });
            baseline = streakLongestConsecutive(
              days.map((d) => d.day),
              challenge.startDay,
              challenge.endDay,
            );
          } else {
            try {
              const learned = await getLearnedSourates(p.userId);
              const mastered = new Set(learned.map((s) => s.numero));
              const wanted =
                (challenge.goal as { sourateNumeros?: number[] })?.sourateNumeros ??
                [];
              baseline = wanted.filter((n) => mastered.has(n)).length;
            } catch {
              baseline = 0;
            }
          }

          await prisma.challengeParticipant.update({
            where: { id: p.id },
            data: { baseline, progress: 0 },
          });

          if (p.status === 'invited') {
            await prisma.challengeParticipant.update({
              where: { id: p.id },
              data: { status: 'expired' },
            });
          }
        }

        // Push challenge_started à chaque participant.
        await prisma.$transaction(async (tx) => {
          for (const p of challenge.participants) {
            await enqueue(tx, {
              type: 'challenge_started',
              userId: p.userId,
              payload: { type: challenge.type, id: challenge.id },
            });
          }
        });

        activated++;
      } else {
        await prisma.challenge.update({
          where: { id: challenge.id, status: 'pending' },
          data: { status: 'cancelled' },
        });
        cancelled++;
      }
    }

    return { activated, cancelled };
  });
}
export async function runAllMaintenance(now: Date = new Date()) {
  // Les foyers expirés d'abord : ça recalcule le premium effectif des membres
  // avant le downgrade global.
  const households = await expireHouseholds(now);
  const [tokens, premium, rollover, reminders, outbox, activated] =
    await Promise.all([
      purgeRefreshTokens(now),
      downgradeExpiredPremium(now),
      runWeeklyRollover(now),
      runReminders(now),
      processOutbox(now),
      activateChallenges(now),
    ]);
  return {
    households,
    tokens,
    premium,
    rollover,
    reminders,
    outbox,
    activated,
  };
}

// CLI entrypoint. `pathToFileURL` (et non une concaténation `file://`) pour que
// la détection marche aussi sous Windows, où argv[1] contient des backslashes.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const which = process.argv[2];

  // Le client Redis n'accepte aucune commande avant 'ready' (offline queue
  // désactivée) : on attend la connexion, sinon le premier withLock échoue.
  const waitForRedis = async () => {
    const client = redis;
    if (!client || client.status === 'ready') return;
    await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(
        () => reject(new Error('Redis unreachable after 10s')),
        10_000,
      );
      client.once('ready', () => {
        clearTimeout(timer);
      resolve();
      });
    });
  };

  const run = async () => {
    await waitForRedis();
    switch (which) {
      case 'purge-tokens':
        return purgeRefreshTokens();
      case 'downgrade-premium':
        return downgradeExpiredPremium();
      case 'expire-households':
        return expireHouseholds();
      case 'rollover':
        return runWeeklyRollover();
      case 'reminders':
        return runReminders();
      case 'process-outbox':
      case 'outbox':
        return processOutbox();
      case 'activate-challenges':
        return activateChallenges();
      default:
        return runAllMaintenance();
    }
  };
  run()
    .then(async (r) => {
      // eslint-disable-next-line no-console
      console.log('Maintenance:', JSON.stringify(r));
      // Ferme les connexions, sinon le process ne se termine jamais et chaque
      // exécution du cron resterait suspendue.
      await Promise.all([prisma.$disconnect(), redis?.quit()]);
      // process.exit() ne vide pas les buffers stdout en attente (pertinent
      // quand le scheduler redirige/pipe la sortie) : on attend explicitement
      // le flush du console.log ci-dessus avant de couper le process.
      await new Promise<void>((resolve) => process.stdout.write('', () => resolve()));
      process.exit(0);
    })
    .catch((e) => {
      // eslint-disable-next-line no-console
      console.error(e);
      process.exit(1);
    });
}

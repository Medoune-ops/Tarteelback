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
import { drainOutbox as runOutboxDrain } from '../core/outbox.js';
import { activateDueChallenges, finishDueChallenges } from '../modules/challenges/challenges.progress.js';

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
 * Démarre les défis dont la date de début est passée (au moins 2 acceptés),
 * annule les autres. Relançable sans effet (verrou ligne par défi).
 */
export async function activateChallenges(now: Date = new Date()) {
  return withLock('job:activate-challenges', LOCK_TTL_MS, async () => activateDueChallenges(now));
}

/**
 * Termine tout défi "active" dont endsAt est passé : progression recalculée une
 * dernière fois, gagnants, rangs, récompenses, push. Idempotent (verrou + UPDATE
 * conditionnel dans finishChallenge).
 */
export async function finalizeChallenges(now: Date = new Date()) {
  return withLock('job:finalize-challenges', LOCK_TTL_MS, async () => {
    const finalized = await finishDueChallenges(now);
    return { finalized };
  });
}

/**
 * Purge les données liées aux amis (ticket 5.1) :
 * - événements traités depuis plus de 14 jours (DomainEvent)
 * - invitations expirées (FriendInvite)
 * - messages masqués depuis plus de 90 jours (FriendMessage)
 * Idempotent : relançable sans effet.
 */
export async function purgeFriendsData(now: Date = new Date()) {
  return withLock('job:purge-friends-data', LOCK_TTL_MS, async () => {
    const cutoff14d = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);
    const cutoff90d = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);

    // Événements traités depuis plus de 14 jours.
    const deletedEvents = await prisma.domainEvent.deleteMany({
      where: {
        processedAt: { not: null, lt: cutoff14d },
      },
    });

    // Invitations expirées.
    const deletedInvites = await prisma.friendInvite.deleteMany({
      where: {
        expiresAt: { lt: now },
      },
    });

    // Messages masqués depuis plus de 90 jours.
    const deletedMessages = await prisma.friendMessage.deleteMany({
      where: {
        hiddenAt: { not: null, lt: cutoff90d },
      },
    });

    return {
      deletedEvents: deletedEvents.count,
      deletedInvites: deletedInvites.count,
      deletedMessages: deletedMessages.count,
    };
  });
}

export async function runAllMaintenance(now: Date = new Date()) {
  // Les foyers expirés d'abord : ça recalcule le premium effectif des membres
  // avant le downgrade global.
  const households = await expireHouseholds(now);
  const [tokens, premium, rollover, reminders, purged] =
    await Promise.all([
      purgeRefreshTokens(now),
      downgradeExpiredPremium(now),
      runWeeklyRollover(now),
      runReminders(now),
      purgeFriendsData(now),
    ]);
  // Défis puis file d'événements, dans cet ordre : démarrer/terminer un défi
  // émet des événements (push, réussites) que le passage suivant traite tout
  // de suite, au lieu d'attendre la prochaine exécution du job.
  const activated = await activateChallenges(now);
  const finalized = await finalizeChallenges(now);
  const outbox = await processOutbox(now);
  return {
    households,
    tokens,
    premium,
    rollover,
    reminders,
    activated,
    finalized,
    outbox,
    purged,
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
      case 'finalize-challenges':
        return finalizeChallenges();
      case 'purge-friends-data':
        return purgeFriendsData();
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

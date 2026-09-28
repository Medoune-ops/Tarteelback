/**
 * Push reminder logic — timezone-aware, idempotent per local day.
 *
 *  - Streak alert: for users whose streak is FROZEN (one missed day → about to
 *    break), once per local day.
 *  - Inactivity reminder: for users who haven't opened the app for 3, 7, 14 then
 *    30 days (one push per threshold, reset when they come back).
 *
 * Le rappel quotidien d'apprentissage n'est plus envoyé par le serveur : l'app le
 * programme en notification locale à `reminderHour`. L'envoyer aussi d'ici
 * faisait recevoir deux notifications à la même heure.
 *
 * Run periodically (e.g. hourly) via `npm run jobs:reminders`. The job itself is
 * lock-guarded (see jobs/maintenance) so only one instance runs it.
 */
import { prisma } from '../../config/prisma.js';
import { localDayKey } from '../../core/streak.js';
import { notificationService } from './notification.service.js';
import { dailyReminder } from './reminderMessages.js';

const REMINDER_BATCH = 500;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Paliers (en jours sans ouvrir l'app) déclenchant une relance, un push chacun.
 *  Après le dernier, on n'insiste plus. */
export const INACTIVITY_THRESHOLDS_DAYS = [3, 7, 14, 30] as const;

/** Current local hour (0–23) for a timezone. */
function localHour(date: Date, timezone: string): number {
  try {
    const s = new Intl.DateTimeFormat('en-GB', {
      timeZone: timezone,
      hour: '2-digit',
      hour12: false,
    }).format(date);
    return Number(s.slice(0, 2));
  } catch {
    return date.getUTCHours();
  }
}

/** Heure locale d'envoi de la relance : 13h, décalée à 18h si le rappel local
 *  de l'app tombe autour de midi, pour ne jamais arriver en même temps. */
export function inactivityHour(reminderHour: number): number {
  return Math.abs(reminderHour - 13) <= 2 ? 18 : 13;
}

export async function sendDueStreakAlerts(now: Date = new Date()) {
  let processed = 0;
  let cursor: string | undefined;
  let sentTotal = 0;

  for (;;) {
    const users = await prisma.user.findMany({
      where: {
        notifStreakAlert: true,
        streakFrozen: true,
        streak: { gt: 0 },
        deviceTokens: { some: { disabledAt: null } },
      },
      select: { id: true, timezone: true, language: true, streak: true, lastStreakAlertOn: true },
      orderBy: { id: 'asc' },
      take: REMINDER_BATCH,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
    });
    if (users.length === 0) break;

    for (const u of users) {
      const todayKey = localDayKey(now, u.timezone);
      if (u.lastStreakAlertOn === todayKey) continue;

      // Même bibliothèque de messages (verbatim), dans la langue du compte.
      const msg = dailyReminder(u.language);
      const res = await notificationService.sendToUser(u.id, {
        title: msg.title,
        body: msg.body,
        data: { type: 'streak_alert', streak: u.streak },
      });
      if (res.sent > 0) sentTotal++;
      await prisma.user.update({ where: { id: u.id }, data: { lastStreakAlertOn: todayKey } });
    }

    processed += users.length;
    cursor = users[users.length - 1]!.id;
    if (users.length < REMINDER_BATCH) break;
  }

  return { processed, sent: sentTotal };
}

export async function sendDueInactivityReminders(now: Date = new Date()) {
  let processed = 0;
  let cursor: string | undefined;
  let sentTotal = 0;
  const firstThreshold = new Date(now.getTime() - INACTIVITY_THRESHOLDS_DAYS[0] * DAY_MS);

  for (;;) {
    const users = await prisma.user.findMany({
      where: {
        // Même opt-out que le rappel quotidien : c'est un rappel d'apprentissage.
        notifDailyReminder: true,
        bannedAt: null,
        lastSeenAt: { lte: firstThreshold },
        inactivityReminderStage: { lt: INACTIVITY_THRESHOLDS_DAYS.length },
        deviceTokens: { some: { disabledAt: null } },
      },
      select: { id: true, timezone: true, language: true, reminderHour: true, lastSeenAt: true, inactivityReminderStage: true },
      orderBy: { id: 'asc' },
      take: REMINDER_BATCH,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
    });
    if (users.length === 0) break;

    for (const u of users) {
      const daysAway = Math.floor((now.getTime() - u.lastSeenAt!.getTime()) / DAY_MS);
      // Palier atteint = nombre de seuils dépassés. Quelqu'un parti depuis 20 j au
      // déploiement reçoit directement le palier 14 j, pas 3 pushs d'affilée.
      const stage = INACTIVITY_THRESHOLDS_DAYS.filter((d) => daysAway >= d).length;
      if (stage <= u.inactivityReminderStage) continue;
      // En journée seulement, et pas à l'heure du rappel local de l'app.
      const hour = localHour(now, u.timezone);
      if (hour < inactivityHour(u.reminderHour) || hour >= 22) continue;

      const msg = dailyReminder(u.language);
      const res = await notificationService.sendToUser(u.id, {
        title: msg.title,
        body: msg.body,
        data: { type: 'inactivity_reminder', days: daysAway },
      });
      if (res.sent > 0) sentTotal++;
      await prisma.user.update({ where: { id: u.id }, data: { inactivityReminderStage: stage } });
    }

    processed += users.length;
    cursor = users[users.length - 1]!.id;
    if (users.length < REMINDER_BATCH) break;
  }

  return { processed, sent: sentTotal };
}

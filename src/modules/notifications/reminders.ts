/**
 * Push reminder logic — timezone-aware, idempotent per local day.
 *
 *  - Daily learning reminder: for users who opted in, haven't completed a lesson
 *    today (local day), once it's their preferred local hour, and who haven't
 *    already been reminded today.
 *  - Streak alert: for users whose streak is FROZEN (one missed day → about to
 *    break), once per local day.
 *
 * Run periodically (e.g. hourly) via `npm run jobs:reminders`. The job itself is
 * lock-guarded (see jobs/maintenance) so only one instance runs it.
 */
import { prisma } from '../../config/prisma.js';
import { localDayKey } from '../../core/streak.js';
import { notificationService } from './notification.service.js';
import { dailyReminder } from './reminderMessages.js';

const REMINDER_BATCH = 500;

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

export async function sendDueDailyReminders(now: Date = new Date()) {
  let processed = 0;
  let cursor: string | undefined;
  let sentTotal = 0;

  for (;;) {
    const users = await prisma.user.findMany({
      where: { notifDailyReminder: true, deviceTokens: { some: { disabledAt: null } } },
      select: { id: true, timezone: true, reminderHour: true, lastActivityDate: true, lastDailyReminderOn: true },
      orderBy: { id: 'asc' },
      take: REMINDER_BATCH,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
    });
    if (users.length === 0) break;

    for (const u of users) {
      const todayKey = localDayKey(now, u.timezone);
      // Already reminded today?
      if (u.lastDailyReminderOn === todayKey) continue;
      // Not yet their preferred local hour?
      if (localHour(now, u.timezone) < u.reminderHour) continue;
      // Already practised today? No need to nag.
      const activeToday = u.lastActivityDate && localDayKey(u.lastActivityDate, u.timezone) === todayKey;
      if (activeToday) continue;

      // Tire au hasard l'un des messages fournis (verbatim).
      const msg = dailyReminder();
      const res = await notificationService.sendToUser(u.id, {
        title: msg.title,
        body: msg.body,
        data: { type: 'daily_reminder' },
      });
      if (res.sent > 0) sentTotal++;
      await prisma.user.update({ where: { id: u.id }, data: { lastDailyReminderOn: todayKey } });
    }

    processed += users.length;
    cursor = users[users.length - 1]!.id;
    if (users.length < REMINDER_BATCH) break;
  }

  return { processed, sent: sentTotal };
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
      select: { id: true, timezone: true, streak: true, lastStreakAlertOn: true },
      orderBy: { id: 'asc' },
      take: REMINDER_BATCH,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
    });
    if (users.length === 0) break;

    for (const u of users) {
      const todayKey = localDayKey(now, u.timezone);
      if (u.lastStreakAlertOn === todayKey) continue;

      // Même bibliothèque de messages (verbatim), tirés au hasard.
      const msg = dailyReminder();
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

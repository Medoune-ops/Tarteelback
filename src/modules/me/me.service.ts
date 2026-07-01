import type { User } from '@prisma/client';
import { prisma } from '../../config/prisma.js';
import { computeHearts } from '../../core/hearts.js';
import { isPremiumActive } from '../../core/premium.js';
import { refreshStreak } from '../../core/streak.js';
import { userRepository } from './user.repository.js';
import type { UpdateMeInput, UpdateSettingsInput } from './me.schemas.js';
import { initialsFrom } from '../../core/tokens.js';
import { computeUserStats } from './user.stats.js';
import { serializeUserFlat } from './user.serializer.js';

/**
 * Recompute the time-sensitive parts of a user's state (hearts regen, streak
 * freeze/break, premium expiry) and persist any change. Centralised so GET /me
 * and every "sync" endpoint stay consistent. Returns the up-to-date user.
 */
export async function syncUserState(user: User, now: Date = new Date()): Promise<User> {
  const premium = isPremiumActive(user, now);

  const data: Record<string, unknown> = {};

  // Premium expiry: silently downgrade.
  if (user.isPremium && !premium) {
    data.isPremium = false;
  }

  // Hearts.
  const hearts = computeHearts(
    { hearts: user.hearts, lastHeartLossAt: user.lastHeartLossAt },
    premium,
    now,
  );
  if (hearts.hearts !== user.hearts) data.hearts = hearts.hearts;
  if (hearts.lastHeartLossAt?.getTime() !== user.lastHeartLossAt?.getTime()) {
    data.lastHeartLossAt = hearts.lastHeartLossAt;
  }

  // Streak.
  const streak = refreshStreak(
    {
      streak: user.streak,
      streakFrozen: user.streakFrozen,
      lastStreakValue: user.lastStreakValue,
      lastActivityDate: user.lastActivityDate,
    },
    user.timezone,
    now,
  );
  if (streak.streak !== user.streak) data.streak = streak.streak;
  if (streak.streakFrozen !== user.streakFrozen) data.streakFrozen = streak.streakFrozen;
  if (streak.lastStreakValue !== user.lastStreakValue) {
    data.lastStreakValue = streak.lastStreakValue;
  }

  if (Object.keys(data).length === 0) return user;
  return userRepository.update(user.id, data);
}

export const meService = {
  /** GET /me: load, sync, return. */
  async get(userId: string): Promise<User> {
    const user = await userRepository.getOrThrow(userId);
    return syncUserState(user);
  },

  /**
   * Flat /me payload for the RN store (hydrateFromBackend). Syncs time-based
   * state, then merges in the derived progression stats.
   */
  async getFlat(userId: string, now: Date = new Date()) {
    const user = await syncUserState(await userRepository.getOrThrow(userId), now);
    const stats = await computeUserStats(userId);
    return serializeUserFlat(user, stats, now);
  },

  /** PATCH /me: update profile fields. */
  async update(userId: string, input: UpdateMeInput): Promise<User> {
    const data: Record<string, unknown> = { ...input };
    if (input.displayName) data.avatarInitials = initialsFrom(input.displayName);
    const user = await userRepository.update(userId, data);
    return syncUserState(user);
  },

  /** PATCH /me/settings: app preferences (voice toggle, language). */
  async updateSettings(userId: string, input: UpdateSettingsInput): Promise<User> {
    const user = await userRepository.update(userId, { ...input });
    return syncUserState(user);
  },

  /**
   * GET /me/activity?month=YYYY-MM — the exact local days the user was active
   * (completed ≥1 lesson) in that month. Powers the profile calendar. `month`
   * is validated as "YYYY-MM"; we match days by string prefix (days are stored
   * as "YYYY-MM-DD" in the user's timezone).
   */
  async getActivityDays(userId: string, month: string): Promise<string[]> {
    const rows = await prisma.activityDay.findMany({
      where: { userId, day: { startsWith: `${month}-` } },
      select: { day: true },
      orderBy: { day: 'asc' },
    });
    return rows.map((r) => r.day);
  },
};

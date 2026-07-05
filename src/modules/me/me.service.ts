import type { User } from '@prisma/client';
import { prisma } from '../../config/prisma.js';
import { AppError } from '../../core/errors.js';
import { verifyPassword } from '../../core/password.js';
import { computeHearts } from '../../core/hearts.js';
import { isPremiumActive } from '../../core/premium.js';
import { settleStreak } from '../../core/streak.js';
import { userRepository } from './user.repository.js';
import type { UpdateMeInput, UpdateSettingsInput } from './me.schemas.js';
import { initialsFrom } from '../../core/tokens.js';
import { computeUserStats } from './user.stats.js';
import { getLearnedSourates } from './learnedSourates.js';
import { serializeUserFlat } from './user.serializer.js';
import { applyOnboardingStart } from './onboardingStart.js';

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

  // Streak. Missed days beyond the free grace day consume streak-freeze items
  // (unlimited for Plus — nothing decremented) before breaking the streak.
  const settle = settleStreak(
    {
      streak: user.streak,
      streakFrozen: user.streakFrozen,
      lastStreakValue: user.lastStreakValue,
      lastActivityDate: user.lastActivityDate,
    },
    user.timezone,
    now,
    premium ? Number.POSITIVE_INFINITY : user.streakFreezes,
  );
  const streak = settle.state;
  const freezesConsumed = premium ? 0 : settle.freezesConsumed;
  if (streak.streak !== user.streak) data.streak = streak.streak;
  if (streak.streakFrozen !== user.streakFrozen) data.streakFrozen = streak.streakFrozen;
  if (streak.lastStreakValue !== user.lastStreakValue) {
    data.lastStreakValue = streak.lastStreakValue;
  }
  if (freezesConsumed > 0) {
    data.streakFreezes = Math.max(0, user.streakFreezes - freezesConsumed);
    // Persist the settled anchor (yesterday) so the consumption is not
    // re-counted on the next sync.
    data.lastActivityDate = streak.lastActivityDate;
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
    // `sourates` n'est pas un champ User (onboarding only) — on l'extrait.
    const { sourates, ...profile } = input;
    const data: Record<string, unknown> = { ...profile };
    if (profile.displayName) data.avatarInitials = initialsFrom(profile.displayName);
    let user: User;
    try {
      user = await userRepository.update(userId, data);
    } catch (e) {
      // Unicité du pseudo : même code d'erreur qu'à l'inscription pour que le
      // front affiche « déjà pris » sous le champ.
      if (profile.username && (e as { code?: string }).code === 'P2002') {
        throw new AppError('USERNAME_TAKEN', 'Username already taken');
      }
      throw e;
    }

    // À la fin de l'onboarding, personnalise le point de départ du parcours :
    // saute l'alphabet si l'utilisateur sait lire + les sourates mémorisées.
    if (input.onboardingDone) {
      await applyOnboardingStart(userId, user.level, sourates ?? []);
    }

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

  /**
   * GET /me/sourates — the surahs the user has learned in full (every lesson of
   * a section teaching the surah is completed). Powers the "Sourates apprises"
   * badge list; read-only.
   */
  async getLearnedSourates(userId: string) {
    return getLearnedSourates(userId);
  },

  /**
   * DELETE /me — suppression définitive du compte. Toutes les relations ont
   * `onDelete: Cascade` : progression, sessions, tokens push, transactions,
   * ledger de gemmes… tout part avec la ligne User. Irréversible.
   *
   * Re-authentification : quand le compte a un mot de passe, il DOIT être
   * fourni et vérifié — un access token volé ne suffit pas à détruire le
   * compte. Les comptes sans hash (OAuth-only) passent sans mot de passe.
   */
  async deleteAccount(userId: string, password?: string): Promise<void> {
    const user = await userRepository.getOrThrow(userId);
    if (user.passwordHash != null) {
      const ok = password != null && (await verifyPassword(user.passwordHash, password));
      if (!ok) {
        throw new AppError('INVALID_CREDENTIALS', 'Password confirmation required');
      }
    }
    await prisma.user.delete({ where: { id: userId } });
  },
};

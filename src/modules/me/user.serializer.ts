import type { User } from '@prisma/client';
import { isPremiumActive } from '../../core/premium.js';
import { snapshot, MAX_HEARTS } from '../../core/hearts.js';
import { localDayKey } from '../../core/streak.js';
import { isDoubleXpActive, REVIEW_HEARTS_PER_DAY } from '../../core/gems.js';
import type { UserStats } from './user.stats.js';

/**
 * Public shape of the current user, matching what the RN store needs
 * (store/userStore.ts): stats, hearts snapshot, streak, premium, profile.
 * Hearts are always returned freshly computed.
 */
export function serializeUser(user: User, now: Date = new Date()) {
  const premium = isPremiumActive(user, now);
  const hearts = snapshot(
    { hearts: user.hearts, lastHeartLossAt: user.lastHeartLossAt },
    premium,
    now,
  );

  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    avatarInitials: user.avatarInitials,
    role: user.role,

    level: user.level,
    objectif: user.objectif,
    dailyMinutes: user.dailyMinutes,
    onboardingDone: user.onboardingDone,
    timezone: user.timezone,
    language: user.language,

    isPremium: premium,
    premiumUntil: user.premiumUntil,

    xp: user.xp,
    weeklyXp: user.weeklyXp,

    // Gem economy.
    gems: user.gems,
    streakFreezes: user.streakFreezes,
    doubleXpUntil: user.doubleXpUntil,
    doubleXpActive: isDoubleXpActive(user.doubleXpUntil, now),
    // "Réviser pour regagner" gate: hearts still regainable via review today.
    reviewHeartsRemaining:
      user.reviewHeartsDay === localDayKey(now, user.timezone)
        ? Math.max(0, REVIEW_HEARTS_PER_DAY - user.reviewHeartsUsed)
        : REVIEW_HEARTS_PER_DAY,

    hearts: {
      count: hearts.hearts,
      max: hearts.unlimited ? null : MAX_HEARTS,
      unlimited: hearts.unlimited,
      outOfHearts: hearts.outOfHearts,
      msUntilNextHeart: hearts.msUntilNextHeart,
    },

    streak: user.streak,
    streakFrozen: user.streakFrozen,
    lastStreakValue: user.lastStreakValue,
    streakGoal: user.streakGoal,

    // Daily chest availability (per the user's local day).
    dailyChestAvailable: user.lastChestDay !== localDayKey(now, user.timezone),
  };
}

/**
 * FLAT shape consumed directly by the RN store's `hydrateFromBackend`
 * (store/userStore.ts + BACKEND.md). The store expects a plain object — no
 * `user` wrapper, hearts as a number, and `lastHeartLossAt` as an epoch-ms
 * timestamp (null when full). `currentLesson`, `sourates` and `precision` are
 * derived stats (see computeUserStats). This is the contract for GET /me and
 * POST /lesson/complete; the richer serializeUser stays for auth responses.
 */
export function serializeUserFlat(user: User, stats: UserStats, now: Date = new Date()) {
  const premium = isPremiumActive(user, now);
  const hearts = snapshot(
    { hearts: user.hearts, lastHeartLossAt: user.lastHeartLossAt },
    premium,
    now,
  );

  return {
    streak: user.streak,
    xp: user.xp,
    hearts: hearts.hearts,
    gems: user.gems,
    streakFreezes: user.streakFreezes,
    // Epoch ms like lastHeartLossAt; null when no boost is running.
    doubleXpUntil: isDoubleXpActive(user.doubleXpUntil, now)
      ? user.doubleXpUntil!.getTime()
      : null,
    isPremium: premium,
    currentLesson: stats.currentLesson,
    // Front uses this as the regen anchor; null when hearts are full.
    lastHeartLossAt: hearts.lastHeartLossAt ? hearts.lastHeartLossAt.getTime() : null,
    sourates: stats.sourates,
    precision: stats.precision,
    // Onboarding/setup state — the front routes to the setup flow only when
    // `onboardingDone` is false. Persisting & returning these here is what stops
    // the setup from re-running on every login.
    onboardingDone: user.onboardingDone,
    level: user.level,
    objectif: user.objectif,
    dailyMinutes: user.dailyMinutes,
    // Profile fields the front's Settings screen needs (optional on the front,
    // but without them it shows "Mon profil / —"). `avatar` is a URL or null;
    // we don't store uploaded avatars yet, so it's null (the front falls back to
    // `avatarInitials`-style initials from `name`).
    name: user.displayName,
    email: user.email,
    avatar: null as string | null,
  };
}

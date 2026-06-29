import type { User } from '@prisma/client';
import { isPremiumActive } from '../../core/premium.js';
import { snapshot, MAX_HEARTS } from '../../core/hearts.js';

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
  };
}

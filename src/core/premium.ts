import { env } from '../config/env.js';

/**
 * Premium is active only when the flag is set AND premiumUntil is in the
 * future. Expired premium silently downgrades to free.
 */
export function isPremiumActive(
  user: { isPremium: boolean; premiumUntil: Date | null },
  now: Date = new Date(),
): boolean {
  if (!user.isPremium) return false;
  if (user.premiumUntil == null) return true; // lifetime / no expiry set
  return user.premiumUntil.getTime() > now.getTime();
}

/** Apply the premium XP multiplier server-side. */
export function applyXpMultiplier(amount: number, premium: boolean): number {
  return premium ? amount * env.PREMIUM_XP_MULTIPLIER : amount;
}

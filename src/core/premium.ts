import { env } from '../config/env.js';

/**
 * Sentinel "until" date used to represent an admin grant of indeterminate
 * duration (previously encoded as `null`, which collided with household.ts's
 * opposite convention where `null` means "no personal premium" — see
 * resolveEffectiveUntil). Using a real (far future) date instead means every
 * premium check is a single, unambiguous date comparison.
 */
export const INDEFINITE_PREMIUM_UNTIL = new Date('2999-01-01T00:00:00.000Z');

/**
 * Premium is active only when the flag is set AND premiumUntil is in the
 * future. Expired premium silently downgrades to free. `premiumUntil: null`
 * is treated as "no premium" (not lifetime) — use INDEFINITE_PREMIUM_UNTIL
 * for grants of indeterminate duration.
 */
export function isPremiumActive(
  user: { isPremium: boolean; premiumUntil: Date | null },
  now: Date = new Date(),
): boolean {
  if (!user.isPremium) return false;
  if (user.premiumUntil == null) return false;
  return user.premiumUntil.getTime() > now.getTime();
}

/** Apply the premium XP multiplier server-side. */
export function applyXpMultiplier(amount: number, premium: boolean): number {
  return premium ? amount * env.PREMIUM_XP_MULTIPLIER : amount;
}

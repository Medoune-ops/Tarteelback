/**
 * Heart mechanics — pure, server-authoritative. Mirrors the front store's
 * `computeHearts` so the contract is identical, but the SERVER is the only
 * place a heart is ever lost or regenerated for real.
 *
 * Model: we keep `hearts` + a single anchor `lastHeartLossAt`. Regeneration is
 * derived from elapsed wall-clock time, never from a client-sent value.
 */
import { env } from '../config/env.js';

export const MAX_HEARTS = env.MAX_HEARTS;
export const HEART_REGEN_MS = env.HEART_REGEN_MS;

export interface HeartState {
  hearts: number;
  lastHeartLossAt: Date | null;
}

export interface HeartSnapshot extends HeartState {
  /** ms until the next heart regenerates, or 0 if full / premium. */
  msUntilNextHeart: number;
  /** true when a free user is blocked (0 hearts). */
  outOfHearts: boolean;
  unlimited: boolean;
}

/**
 * Recompute hearts at `now` from the persisted anchor. Premium = always full.
 * Returns the (possibly updated) persistable state.
 */
export function computeHearts(
  state: HeartState,
  isPremium: boolean,
  now: Date = new Date(),
): HeartState {
  if (isPremium) return { hearts: MAX_HEARTS, lastHeartLossAt: null };

  const { hearts, lastHeartLossAt } = state;

  if (hearts >= MAX_HEARTS || lastHeartLossAt == null) {
    return {
      hearts: Math.min(hearts, MAX_HEARTS),
      lastHeartLossAt: hearts >= MAX_HEARTS ? null : lastHeartLossAt,
    };
  }

  const elapsed = now.getTime() - lastHeartLossAt.getTime();
  const regened = Math.floor(elapsed / HEART_REGEN_MS);
  if (regened <= 0) return { hearts, lastHeartLossAt };

  const newHearts = Math.min(MAX_HEARTS, hearts + regened);
  if (newHearts >= MAX_HEARTS) return { hearts: MAX_HEARTS, lastHeartLossAt: null };

  // Regenerated some but not all: advance the anchor by the consumed intervals.
  return {
    hearts: newHearts,
    lastHeartLossAt: new Date(lastHeartLossAt.getTime() + regened * HEART_REGEN_MS),
  };
}

/** ms until the next heart, given an already-synced state. */
export function msUntilNextHeart(
  state: HeartState,
  isPremium: boolean,
  now: Date = new Date(),
): number {
  if (isPremium || state.hearts >= MAX_HEARTS || state.lastHeartLossAt == null) {
    return 0;
  }
  const elapsedInCurrent =
    (now.getTime() - state.lastHeartLossAt.getTime()) % HEART_REGEN_MS;
  return HEART_REGEN_MS - elapsedInCurrent;
}

/**
 * Apply one heart loss (e.g. a wrong answer). No-op for premium.
 * If the user was full, the regen anchor starts now.
 */
export function loseHeart(
  state: HeartState,
  isPremium: boolean,
  now: Date = new Date(),
): HeartState {
  if (isPremium) return { hearts: MAX_HEARTS, lastHeartLossAt: null };
  const wasFull = state.hearts >= MAX_HEARTS;
  const hearts = Math.max(0, state.hearts - 1);
  return {
    hearts,
    lastHeartLossAt: wasFull ? now : state.lastHeartLossAt ?? now,
  };
}

/** Build the full snapshot returned to clients (GET /me, hearts/sync). */
export function snapshot(
  state: HeartState,
  isPremium: boolean,
  now: Date = new Date(),
): HeartSnapshot {
  const synced = computeHearts(state, isPremium, now);
  return {
    ...synced,
    msUntilNextHeart: msUntilNextHeart(synced, isPremium, now),
    outOfHearts: !isPremium && synced.hearts <= 0,
    unlimited: isPremium,
    hearts: isPremium ? MAX_HEARTS : synced.hearts,
  };
}

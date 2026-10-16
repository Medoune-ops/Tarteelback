import { localDayKey } from './streak.js';

/**
 * Logique pure des amis (ticket 1.B2) — aucune dépendance DB / env.
 */

export interface OrderedPair {
  low: string;
  high: string;
}

export const FREE_MAX_FRIENDS = 9;
export const PREMIUM_MAX_FRIENDS = 20;
export const MAX_PENDING_REQUESTS = 50;
export const FREE_MESSAGES_PER_DAY = 3;
export const MESSAGES_PER_DAY = 30;

/** Renvoie la paire rangée { low, high }. Symétrique : orderPair(a,b) === orderPair(b,a). */
export function orderPair(a: string, b: string): OrderedPair {
  return a <= b ? { low: a, high: b } : { low: b, high: a };
}

export function maxFriendsFor(isPremium: boolean): number {
  return isPremium ? PREMIUM_MAX_FRIENDS : FREE_MAX_FRIENDS;
}

/**
 * D-C : un compte au-dessus de sa limite (ancien premium) GARDE ses amis,
 * mais ne peut plus en ajouter. D'où un simple `currentCount < limite`.
 */
export function canAddFriend(currentCount: number, isPremium: boolean): boolean {
  if (!Number.isFinite(currentCount) || currentCount < 0) return false;
  return currentCount < maxFriendsFor(isPremium);
}

/** D-B : les DEUX doivent pouvoir ajouter pour que l'amitié se crée. */
export function canBecomeFriends(
  countA: number,
  premiumA: boolean,
  countB: number,
  premiumB: boolean,
): boolean {
  return canAddFriend(countA, premiumA) && canAddFriend(countB, premiumB);
}


export interface DayWindow { start: Date; end: Date; }

export function dayWindow(user: { timezone?: string | null }, now: Date = new Date()): DayWindow {
  const key = localDayKey(now, user.timezone ?? 'UTC');
  const start = new Date('' + key + 'T00:00:00.000Z');
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  return { start, end };
}


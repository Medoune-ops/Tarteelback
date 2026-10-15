import { AppError } from './errors.js';
import { env } from '../config/env.js';
import { prisma } from '../config/prisma.js';

/**
 * Ticket 0.B4 — socle commun des amis.
 * Module calqué sur modules/referral : garde, sérialisation à liste blanche,
 * aides de pagination par curseur et de comptage DB.
 */

// --------------------------------------------------------------------------- guard
export function isFriendsEnabled(userId?: string | null): boolean {
  if (!env.FRIENDS_ENABLED) return false;
  const beta = env.FRIENDS_BETA_USER_IDS;
  if (!Array.isArray(beta) || beta.length === 0) return true;
  if (userId == null) return false;
  return beta.includes(userId);
}

export function requireFriendsEnabled(userId?: string | null): void {
  if (!isFriendsEnabled(userId)) {
    throw new AppError('FRIENDS_DISABLED');
  }
}

// --------------------------------------------------------------------------- serializer
export interface PublicProfile {
  id: string;
  displayName: string;
  username: string | null;
  avatarInitials: string;
  streak: number;
  learnedSouratesCount: number;
  leagueTier: string;
  weeklyXp: number;
}

export interface PublicProfileInput {
  id: unknown;
  displayName: unknown;
  username?: unknown;
  avatarInitials?: unknown;
  streak?: unknown;
  learnedSouratesCount?: unknown;
  leagueTier?: unknown;
  weeklyXp?: unknown;
}

/** LECTURE SEULE — ne recopie QUE les 8 clés de la liste blanche. */
export function serializePublicProfile(row: PublicProfileInput): PublicProfile {
  return {
    id: String(row.id ?? ''),
    displayName: String(row.displayName ?? ''),
    username: row.username == null ? null : String(row.username),
    avatarInitials: String(row.avatarInitials ?? ''),
    streak: Number(row.streak ?? 0),
    learnedSouratesCount: Number(row.learnedSouratesCount ?? 0),
    leagueTier: String(row.leagueTier ?? ''),
    weeklyXp: Number(row.weeklyXp ?? 0),
  };
}

// Alias pour compat / conventions alternatives.
export const serializePublicProfileUser = serializePublicProfile;
export const toPublicProfile = serializePublicProfile;

// --------------------------------------------------------------------------- assertion
export function assertFriends(_me: string, _other: string, areFriends = false): void {
  if (!areFriends) {
    throw new AppError('NOT_FRIENDS');
  }
}

// --------------------------------------------------------------------------- pagination
export const DEFAULT_PAGE_LIMIT = 20;
export const MAX_PAGE_LIMIT = 50;

export interface CursorPagination {
  cursor: string | null;
  limit: number;
}

export function parseCursorPagination(input?: unknown): CursorPagination {
  const q = (input ?? {}) as Record<string, unknown>;
  const rawCursor = q.cursor ?? q.nextCursor ?? null;
  const cursor = rawCursor == null ? null : String(rawCursor);

  const rawLimit = q.limit ?? q.pageSize ?? q.size ?? DEFAULT_PAGE_LIMIT;
  let limit = Number(rawLimit);
  if (!Number.isFinite(limit) || limit < 1) limit = DEFAULT_PAGE_LIMIT;
  limit = Math.min(Math.max(1, Math.trunc(limit)), MAX_PAGE_LIMIT);
  return { cursor, limit };
}

export interface CursorPage<T> {
  items: T[];
  nextCursor: string | null;
}

export function buildCursorPage<T>(
  items: T[],
  limit: number,
  getCursor?: (item: T) => unknown,
): CursorPage<T> {
  const safeLimit = Math.min(Math.max(1, Math.trunc(limit || DEFAULT_PAGE_LIMIT)), MAX_PAGE_LIMIT);
  const pageItems = items.slice(0, safeLimit);
  const hasMore = items.length > safeLimit;
  const last = pageItems[pageItems.length - 1];
  const raw = hasMore && last ? (getCursor ? getCursor(last) : (last as { id?: unknown })?.id ?? null) : null;
  return {
    items: pageItems,
    nextCursor: raw == null ? null : String(raw),
  };
}

export const paginateCursor = buildCursorPage;
export const formatCursorPage = buildCursorPage;

// --------------------------------------------------------------------------- quotas (comptage en base)
export async function countFriendsInDb(userId: string): Promise<number> {
  // Le modèle `Friendship` sera ajouté par les tickets suivants.
  // On reste tolérant pour ne pas casser le typage tant qu'il n'existe pas.
  const model = (prisma as unknown as { friendship?: { count: (a: unknown) => Promise<number> } }).friendship;
  if (!model || typeof model.count !== 'function') return 0;
  try {
    return await model.count({ where: { OR: [{ user1Id: userId }, { user2Id: userId }] } });
  } catch {
    return 0;
  }
}

export async function countDbRows(modelName: string, where: Record<string, unknown>): Promise<number> {
  const model = (prisma as unknown as Record<string, { count?: (a: unknown) => Promise<number> }>)[modelName];
  if (!model || typeof model.count !== 'function') return 0;
  try {
    return await model.count({ where });
  } catch {
    return 0;
  }
}

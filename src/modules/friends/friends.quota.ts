import type { Prisma, FriendSendType } from '@prisma/client';
import { prisma } from '../../config/prisma.js';
import { AppError } from '../../core/errors.js';
import { FRIEND_DAILY_SEND_LIMIT, utcDayStart } from '../../core/friends.js';

/** Un client Prisma (transaction ou client partagé). */
type Db = Prisma.TransactionClient | typeof prisma;

export interface SendQuotaStatus {
  /** Envois déjà consommés aujourd'hui (jour calendaire UTC). */
  used: number;
  /** Plafond quotidien (3). */
  limit: number;
  remaining: number;
  /** Minuit UTC du jour courant (clé de comptage). */
  day: string;
}

/**
 * Quota d'envois « à un ami » — 3 par jour calendaire UTC, TOUS TYPES
 * CONFONDUS (hadith, réussite, encouragement, relance). Backend
 * server-authoritative : le mobile ne fait qu'afficher le résultat.
 */
export async function getSendQuota(
  userId: string,
  now: Date = new Date(),
  db: Db = prisma,
): Promise<SendQuotaStatus> {
  const day = utcDayStart(now);
  const used = await db.friendSendLog.count({ where: { senderId: userId, day } });
  return {
    used,
    limit: FRIEND_DAILY_SEND_LIMIT,
    remaining: Math.max(0, FRIEND_DAILY_SEND_LIMIT - used),
    day: day.toISOString(),
  };
}

/**
 * Consomme UN envoi du quota et journalise l'envoi. À appeler DANS une
 * transaction métier (l'envoi réel et le débit du quota doivent être atomiques).
 *
 * Race-safe : verrouille la ligne User (`SELECT ... FOR UPDATE`) avant de
 * compter, pour que deux envois concurrents ne dépassent jamais le plafond.
 * Lève FRIEND_SEND_QUOTA_EXCEEDED (429) si le quota est déjà épuisé.
 */
export async function consumeSendQuota(
  tx: Prisma.TransactionClient,
  userId: string,
  type: FriendSendType,
  now: Date = new Date(),
): Promise<SendQuotaStatus> {
  const day = utcDayStart(now);

  // Verrou pessimiste sur l'utilisateur : sérialise les envois concurrents.
  await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${userId} FOR UPDATE`;

  const used = await tx.friendSendLog.count({ where: { senderId: userId, day } });
  if (used >= FRIEND_DAILY_SEND_LIMIT) {
    throw new AppError(
      'FRIEND_SEND_QUOTA_EXCEEDED',
      'Daily friend-send quota reached',
    );
  }

  await tx.friendSendLog.create({ data: { senderId: userId, type, day } });

  const nextUsed = used + 1;
  return {
    used: nextUsed,
    limit: FRIEND_DAILY_SEND_LIMIT,
    remaining: Math.max(0, FRIEND_DAILY_SEND_LIMIT - nextUsed),
    day: day.toISOString(),
  };
}

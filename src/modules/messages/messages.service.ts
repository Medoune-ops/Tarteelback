import { AppError } from '../../core/errors.js';
import { requireFriendsEnabled } from '../friends/friends.guard.js';
import { isPremiumActive } from '../../core/premium.js';
import { enqueue } from '../../core/outbox.js';
import { prisma } from '../../config/prisma.js';
import { challengeRepository } from '../challenges/challenges.repository.js';
import { MessageSendInput } from './messages.schemas.js';

const FREE_DAILY_QUOTA = 3;
const PREMIUM_DAILY_QUOTA = 30;
const DAILY_RECIPIENT_QUOTA = 5;

const MAX_RECIPIENTS = 10;

async function getAcceptedFriendship(meId: string, otherId: string) {
  return challengeRepository.getAcceptedFriendship(meId, otherId);
}

async function isBlockedEither(meId: string, otherId: string) {
  // Import lazy pour éviter les dépendances circulaires
  const { friendsRepository } = await import('../friends/friends.repository.js');
  return friendsRepository.isBlockedEither(meId, otherId);
}

/**
 * Récupère ou crée le quota quotidien de l'utilisateur et incrémente.
 * Retourne le nouveau count après incrémentation.
 */
async function incrementDailyQuota(
  tx: typeof prisma,
  userId: string,
  day: Date,
  amount: number,
): Promise<number> {
  const existing = await tx.dailyQuota.upsert({
    where: { userId_day: { userId, day } },
    create: { userId, day, count: amount },
    update: { count: { increment: amount } },
  });
  return existing.count + amount;
}

/**
 * Récupère ou crée le quota quotidien par destinataire et incrémente de 1.
 */
async function incrementRecipientQuota(
  tx: typeof prisma,
  userId: string,
  recipientId: string,
  day: Date,
): Promise<number> {
  const existing = await tx.dailyRecipientQuota.upsert({
    where: { userId_recipientId_day: { userId, recipientId, day } },
    create: { userId, recipientId, day, count: 1 },
    update: { count: { increment: 1 } },
  });
  return existing.count + 1;
}

/**
 * Lit le quota quotidien actuel (sans incrémenter).
 */
async function getDailyQuotaCount(
  tx: typeof prisma,
  userId: string,
  day: Date,
): Promise<number> {
  const q = await tx.dailyQuota.findUnique({
    where: { userId_day: { userId, day } },
  });
  return q?.count ?? 0;
}

/**
 * Lit le quota quotidien par destinataire actuel (sans incrémenter).
 */
async function getRecipientQuotaCount(
  tx: typeof prisma,
  userId: string,
  recipientId: string,
  day: Date,
): Promise<number> {
  const q = await tx.dailyRecipientQuota.findUnique({
    where: { userId_recipientId_day: { userId, recipientId, day } },
  });
  return q?.count ?? 0;
}

export const messagesService = {
  async send(meId: string, body: MessageSendInput) {
    requireFriendsEnabled(meId);
    const me = await prisma.user.findUnique({
      where: { id: meId },
      select: { id: true, isPremium: true, premiumUntil: true, bannedAt: true },
    });
    if (!me || me.bannedAt) throw new AppError('NOT_FOUND', 'User not found');

    const now = new Date();
    const premium = isPremiumActive(me, now);
    const dailyLimit = premium ? PREMIUM_DAILY_QUOTA : FREE_DAILY_QUOTA;

    const recipientIds = Array.from(new Set(body.recipientIds || [])).filter(
      (id) => id !== meId,
    );
    if (recipientIds.length < 1 || recipientIds.length > MAX_RECIPIENTS) {
      throw new AppError(
        'VALIDATION_ERROR',
        `recipient count must be 1..${MAX_RECIPIENTS}`,
      );
    }

    // Vérifier amis + pas bloqués pour chaque destinataire
    for (const otherId of recipientIds) {
      const fri = await getAcceptedFriendship(meId, otherId);
      if (!fri || fri.status !== 'accepted') {
        throw new AppError('NOT_FRIENDS', 'Not friends');
      }
      const other = await prisma.user.findUnique({
        where: { id: otherId },
        select: { id: true, bannedAt: true },
      });
      if (!other || other.bannedAt) {
        throw new AppError('NOT_FOUND', 'User not found');
      }
      if (await isBlockedEither(meId, otherId)) {
        throw new AppError('BLOCKED', 'Blocked');
      }
    }

    // Validation spécifique du payload par kind
    switch (body.kind) {
      case 'achievement': {
        const payload = body.payload as { achievementId?: string };
        if (!payload.achievementId || typeof payload.achievementId !== 'string') {
          throw new AppError('VALIDATION_ERROR', 'achievementId required');
        }
        break;
      }
    }

    // ── Quotas : "tout ou rien" ──
    // 1. Quota global : count actuel + nombre de destinataires <= dailyLimit
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const currentGlobal = await getDailyQuotaCount(prisma, meId, today);
    if (currentGlobal + recipientIds.length > dailyLimit) {
      throw new AppError('QUOTA_EXCEEDED', 'Daily message quota exceeded');
    }

    // 2. Quota par destinataire : pour chaque destinataire, count actuel + 1 <= 5
    for (const otherId of recipientIds) {
      const currentRecipient = await getRecipientQuotaCount(
        prisma,
        meId,
        otherId,
        today,
      );
      if (currentRecipient + 1 > DAILY_RECIPIENT_QUOTA) {
        throw new AppError(
          'QUOTA_EXCEEDED',
          `Daily recipient quota exceeded for ${otherId}`,
        );
      }
    }

    // ── Créer les messages et incrémenter les quotas dans une transaction ──
    const created = await prisma.$transaction(async (tx: any) => {
      // Incrémenter le quota global de nombre de destinataires
      await incrementDailyQuota(tx, meId, today, recipientIds.length);

      // Incrémenter le quota par destinataire de 1 pour chacun
      for (const otherId of recipientIds) {
        await incrementRecipientQuota(tx, meId, otherId, today);
      }

      // Créer les messages
      const messages = await tx.friendMessage.createMany({
        data: recipientIds.map((recipientId) => ({
          senderId: meId,
          recipientId,
          kind: body.kind,
          payload: body.payload,
          note: body.note ?? null,
        })),
      });

      return messages;
    });

    // ── Émettre un événement outbox pour le push (un par destinataire) ──
    await prisma.$transaction(async (tx: any) => {
      for (const recipientId of recipientIds) {
        await enqueue(tx, {
          type: 'message',
          userId: recipientId,
          payload: {
            senderId: meId,
            kind: body.kind,
          },
        });
      }
    });

    return {
      sent: created.count,
      recipients: recipientIds.length,
    };
  },

  async list(meId: string, cursor?: string | null, limit = 20) {
    requireFriendsEnabled(meId);
    const safeLimit = Math.min(Math.max(1, limit), 50);
    const rows = await prisma.friendMessage.findMany({
      where: {
        recipientId: meId,
        hiddenAt: null,
      },
      orderBy: { createdAt: 'desc' },
      take: safeLimit + 1,
      ...(cursor ? { cursor, skip: 1 } : {}),
      include: {
        sender: {
          select: {
            id: true,
            displayName: true,
            username: true,
            avatarInitials: true,
          },
        },
      },
    });

    const hasMore = rows.length > safeLimit;
    const pageRows = hasMore ? rows.slice(0, safeLimit) : rows;
    const last = pageRows[pageRows.length - 1];
    const nextCursor = hasMore && last ? last.id : null;

    return {
      items: pageRows.map((m: any) => ({
        id: m.id,
        sender: m.sender,
        kind: m.kind,
        payload: m.payload,
        note: m.note,
        readAt: m.readAt,
        createdAt: m.createdAt,
      })),
      nextCursor,
    };
  },

  async read(meId: string, id: string) {
    requireFriendsEnabled(meId);
    const message = await prisma.friendMessage.findUnique({
      where: { id },
    });
    if (!message) throw new AppError('NOT_FOUND', 'Message not found');
    if (message.recipientId !== meId) {
      throw new AppError('NOT_FOUND', 'Message not found');
    }
    if (message.hiddenAt) throw new AppError('NOT_FOUND', 'Message not found');

    await prisma.friendMessage.update({
      where: { id },
      data: { readAt: new Date() },
    });

    return { read: true };
  },

  async remove(meId: string, id: string) {
    requireFriendsEnabled(meId);
    const message = await prisma.friendMessage.findUnique({
      where: { id },
    });
    if (!message) throw new AppError('NOT_FOUND', 'Message not found');
    if (message.recipientId !== meId) {
      throw new AppError('NOT_FOUND', 'Message not found');
    }

    await prisma.friendMessage.update({
      where: { id },
      data: { hiddenAt: new Date() },
    });

    return { removed: true };
  },
};

export { MAX_RECIPIENTS };

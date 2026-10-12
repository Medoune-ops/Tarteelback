import type { Prisma } from '@prisma/client';
import { prisma } from '../../config/prisma.js';
import { AppError } from '../../core/errors.js';
import { notificationService } from '../notifications/notification.service.js';
import { getLearnedSourates } from '../me/learnedSourates.js';
import { friendsRepository } from './friends.repository.js';
import { serializePublicUser } from './friends.serializer.js';
import { consumeSendQuota, getSendQuota } from './friends.quota.js';

export type FriendSendTypeName = 'hadith' | 'success' | 'encouragement' | 'reminder';

function notifCopy(type: FriendSendTypeName, senderName: string): { title: string; body: string } {
  switch (type) {
    case 'hadith':
      return { title: 'Hadith partagé', body: `${senderName} t'a partagé un hadith.` };
    case 'success':
      return { title: 'Bravo !', body: `${senderName} t'envoie une réussite.` };
    case 'reminder':
      return { title: 'Défi', body: `${senderName} te relance sur un défi.` };
    case 'encouragement':
    default:
      return { title: 'Encouragement', body: `${senderName} t'envoie un mot d'encouragement.` };
  }
}

/**
 * Envois « à un ami » + boîte de réception (phase 4). Soumis au QUOTA serveur
 * (3 envois/jour, tous types confondus — voir friends.quota.ts). La création du
 * message et le débit du quota sont atomiques (même transaction).
 */
export const friendsMessagesService = {
  async send(
    userId: string,
    recipientId: string,
    type: FriendSendTypeName,
    payload: Prisma.InputJsonValue,
  ) {
    if (recipientId === userId) {
      throw new AppError('VALIDATION_ERROR', 'You cannot send to yourself');
    }
    const friendship = await friendsRepository.findBetween(userId, recipientId);
    if (!friendship) throw new AppError('NOT_FOUND', 'Friend not found');
    if (await friendsRepository.findBlockBetween(userId, recipientId)) {
      throw new AppError('FRIEND_BLOCKED', 'Unable to send to this user');
    }

    // Règle 2 : le serveur est la seule autorité sur « j'ai réussi ». Pour un
    // envoi de type `success`, on NE FAIT PAS confiance au payload client : on
    // vérifie que l'expéditeur a réellement maîtrisé la sourate (calcul serveur
    // depuis LessonProgress) et on reconstruit le payload depuis cette vérité.
    if (type === 'success') {
      const obj = payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : {};
      const numero = typeof obj.numero === 'number' ? obj.numero : null;
      if (numero == null) {
        throw new AppError('VALIDATION_ERROR', 'success requires a mastered sourate');
      }
      const learned = await getLearnedSourates(userId);
      const match = learned.find((s) => s.numero === numero);
      if (!match) {
        throw new AppError('VALIDATION_ERROR', 'You have not mastered this sourate');
      }
      payload = {
        numero: match.numero,
        nom: match.nom,
        ...(typeof obj.text === 'string' ? { text: obj.text } : {}),
      };
    }

    const { message, quota } = await prisma.$transaction(async (tx) => {
      const q = await consumeSendQuota(tx, userId, type);
      const m = await friendsRepository.createMessage(tx, { senderId: userId, recipientId, type, payload });
      return { message: m, quota: q };
    });

    const sender = await friendsRepository.getUserPublic(userId);
    const copy = notifCopy(type, sender?.displayName ?? 'Un ami');
    await notificationService
      .sendToUser(recipientId, {
        title: copy.title,
        body: copy.body,
        data: { type: 'friend_message', messageType: type, messageId: message.id },
      })
      .catch(() => {});

    return { id: message.id, quota };
  },

  async inbox(userId: string, limit = 50) {
    const [rows, unread] = await Promise.all([
      friendsRepository.listInbox(userId, limit),
      friendsRepository.countUnread(userId),
    ]);
    return {
      unread,
      messages: rows.map((r) => ({
        id: r.id,
        type: r.type,
        payload: r.payload,
        read: r.readAt != null,
        createdAt: r.createdAt.toISOString(),
        sender: serializePublicUser(r.sender),
      })),
    };
  },

  async markRead(userId: string, messageId: string) {
    const msg = await friendsRepository.getMessage(messageId);
    if (!msg || msg.recipientId !== userId) throw new AppError('NOT_FOUND', 'Message not found');
    await friendsRepository.markMessageRead(messageId, userId);
    return { read: true };
  },

  quota(userId: string) {
    return getSendQuota(userId);
  },
};

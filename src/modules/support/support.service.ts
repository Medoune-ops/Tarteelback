import { prisma } from '../../config/prisma.js';
import type { SendSupportMessageInput } from './support.schemas.js';

export const supportService = {
  /** POST /me/support — enregistre un message support (réclamation/suggestion), visible en back-office. */
  async send(userId: string, input: SendSupportMessageInput) {
    const created = await prisma.supportMessage.create({
      data: { userId, message: input.message },
    });
    return { id: created.id, createdAt: created.createdAt };
  },

  /**
   * GET /me/support — le fil complet de la conversation (utilisateur + réponses
   * admin), triées par date. Marque au passage les réponses admin comme lues
   * par l'utilisateur (il vient de les consulter).
   */
  async thread(userId: string) {
    const messages = await prisma.supportMessage.findMany({
      where: { userId },
      orderBy: { createdAt: 'asc' },
    });

    await prisma.supportMessage.updateMany({
      where: { userId, fromAdmin: true, read: false },
      data: { read: true, readAt: new Date() },
    });

    return messages.map((m) => ({
      id: m.id,
      message: m.message,
      fromAdmin: m.fromAdmin,
      createdAt: m.createdAt,
    }));
  },
};

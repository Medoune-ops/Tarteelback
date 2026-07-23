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
};

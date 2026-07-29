import { AppError } from '../../core/errors.js';
import { adminSupportRepository } from './adminSupport.repository.js';
import { notificationService } from '../notifications/notification.service.js';
import type { ListSupportQuery, ReplySupportInput } from './adminSupport.schemas.js';

const DAY_MS = 24 * 60 * 60 * 1000;

export const adminSupportService = {
  /** GET /backoffice/support/messages — une ligne par utilisateur (boîte de réception). */
  async list(query: ListSupportQuery) {
    const { rows, total } = await adminSupportRepository.listThreads(query.q, query.status, query.page, query.pageSize);
    return {
      threads: rows,
      pagination: {
        page: query.page,
        pageSize: query.pageSize,
        total,
        totalPages: Math.ceil(total / query.pageSize),
      },
    };
  },

  /** GET /backoffice/support/summary */
  async summary() {
    return adminSupportRepository.summary(new Date(Date.now() - DAY_MS));
  },

  /** GET /backoffice/support/messages/:userId/thread — fil complet + marque les messages utilisateur comme lus. */
  async thread(userId: string) {
    const user = await adminSupportRepository.userExists(userId);
    if (!user) throw new AppError('NOT_FOUND', 'User not found');

    const messages = await adminSupportRepository.thread(userId);
    if (messages.length === 0) throw new AppError('NOT_FOUND', 'No support thread for this user');

    await adminSupportRepository.markThreadRead(userId, new Date());

    return messages.map((m) => ({
      id: m.id,
      message: m.message,
      fromAdmin: m.fromAdmin,
      createdAt: m.createdAt,
    }));
  },

  /**
   * POST /backoffice/support/messages/:userId/reply — l'admin répond dans le
   * fil de l'utilisateur, puis une notification push est envoyée pour l'en
   * informer (le fil vit dans l'app, pas par email).
   */
  async reply(userId: string, input: ReplySupportInput) {
    const user = await adminSupportRepository.userExists(userId);
    if (!user) throw new AppError('NOT_FOUND', 'User not found');

    const created = await adminSupportRepository.createReply(userId, input.message);

    await notificationService.sendToUser(userId, {
      title: 'Réponse du support Tarteel',
      body: input.message.length > 100 ? `${input.message.slice(0, 100)}…` : input.message,
      data: { kind: 'support_reply' },
    });

    return { id: created.id, createdAt: created.createdAt };
  },
};

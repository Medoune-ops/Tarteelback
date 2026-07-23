import { AppError } from '../../core/errors.js';
import { adminSupportRepository } from './adminSupport.repository.js';
import type { ListSupportQuery } from './adminSupport.schemas.js';

const DAY_MS = 24 * 60 * 60 * 1000;

/** Aplati `{ user: {...} }` en champs plats — c'est le format attendu par le back-office (app.js#renderSupportRows). */
function serialize(row: {
  id: string; message: string; read: boolean; createdAt: Date;
  user: { id: string; email: string; displayName: string; avatarInitials: string };
}) {
  return {
    id: row.id,
    userId: row.user.id,
    email: row.user.email,
    displayName: row.user.displayName,
    avatarInitials: row.user.avatarInitials,
    message: row.message,
    read: row.read,
    createdAt: row.createdAt,
  };
}

export const adminSupportService = {
  /** GET /backoffice/support/messages */
  async list(query: ListSupportQuery) {
    const { rows, total } = await adminSupportRepository.list(query.q, query.status, query.page, query.pageSize);
    return {
      messages: rows.map(serialize),
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

  /** POST /backoffice/support/messages/:id/read — bascule lu <-> non lu. */
  async toggleRead(id: string) {
    const existing = await adminSupportRepository.findById(id);
    if (!existing) throw new AppError('NOT_FOUND', 'Support message not found');
    const updated = await adminSupportRepository.toggleRead(id, !existing.read, new Date());
    return serialize(updated);
  },
};

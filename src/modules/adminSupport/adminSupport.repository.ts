import type { Prisma } from '@prisma/client';
import { prisma } from '../../config/prisma.js';

function userWhereFor(q: string | undefined): Prisma.UserWhereInput {
  if (!q) return {};
  return {
    OR: [
      { email: { contains: q, mode: 'insensitive' } },
      { displayName: { contains: q, mode: 'insensitive' } },
    ],
  };
}

export const adminSupportRepository = {
  /**
   * Une ligne par utilisateur ayant au moins un message support : dernier
   * message du fil + nombre de messages utilisateur non lus par l'admin.
   * `status` filtre sur "a au moins un message non lu" / "aucun non lu".
   */
  async listThreads(q: string | undefined, status: 'all' | 'unread' | 'read', page: number, pageSize: number) {
    const userWhere = userWhereFor(q);

    const candidateUserIds = await prisma.supportMessage.groupBy({
      by: ['userId'],
      where: { user: userWhere },
      _max: { createdAt: true },
    });

    // Filtre "non lus"/"lus" appliqué après groupBy (pas de having simple sur
    // un COUNT conditionnel côté Prisma) — recompte les non-lus par thread.
    const unreadCounts = await prisma.supportMessage.groupBy({
      by: ['userId'],
      where: { userId: { in: candidateUserIds.map((c) => c.userId) }, fromAdmin: false, read: false },
      _count: { _all: true },
    });
    const unreadByUser = new Map(unreadCounts.map((u) => [u.userId, u._count._all]));

    let userIds = candidateUserIds
      .map((c) => ({ userId: c.userId, lastMessageAt: c._max.createdAt!, unread: unreadByUser.get(c.userId) ?? 0 }))
      .sort((a, b) => b.lastMessageAt.getTime() - a.lastMessageAt.getTime());

    if (status === 'unread') userIds = userIds.filter((u) => u.unread > 0);
    else if (status === 'read') userIds = userIds.filter((u) => u.unread === 0);

    const total = userIds.length;
    const page_ = userIds.slice((page - 1) * pageSize, (page - 1) * pageSize + pageSize);

    const users = await prisma.user.findMany({
      where: { id: { in: page_.map((p) => p.userId) } },
      select: { id: true, email: true, displayName: true, avatarInitials: true },
    });
    const userById = new Map(users.map((u) => [u.id, u]));

    const lastMessages = await prisma.supportMessage.findMany({
      where: { userId: { in: page_.map((p) => p.userId) } },
      orderBy: { createdAt: 'desc' },
      distinct: ['userId'],
      select: { userId: true, message: true, fromAdmin: true, createdAt: true },
    });
    const lastMessageByUser = new Map(lastMessages.map((m) => [m.userId, m]));

    const rows = page_.map((p) => {
      const user = userById.get(p.userId);
      const last = lastMessageByUser.get(p.userId);
      return {
        userId: p.userId,
        email: user?.email ?? '',
        displayName: user?.displayName ?? 'Utilisateur',
        avatarInitials: user?.avatarInitials ?? '?',
        lastMessage: last?.message ?? '',
        lastMessageFromAdmin: last?.fromAdmin ?? false,
        lastMessageAt: p.lastMessageAt,
        unread: p.unread,
      };
    });

    return { rows, total };
  },

  thread(userId: string) {
    return prisma.supportMessage.findMany({
      where: { userId },
      orderBy: { createdAt: 'asc' },
    });
  },

  userExists(userId: string) {
    return prisma.user.findUnique({ where: { id: userId }, select: { id: true, displayName: true } });
  },

  createReply(userId: string, message: string) {
    return prisma.supportMessage.create({
      data: { userId, message, fromAdmin: true },
    });
  },

  /** Marque tous les messages UTILISATEUR (non-admin) d'un fil comme lus par l'admin. */
  markThreadRead(userId: string, now: Date) {
    return prisma.supportMessage.updateMany({
      where: { userId, fromAdmin: false, read: false },
      data: { read: true, readAt: now },
    });
  },

  summary(since24h: Date) {
    return Promise.all([
      prisma.supportMessage.count({ where: { fromAdmin: false, read: false } }),
      prisma.supportMessage.groupBy({ by: ['userId'], where: {} }).then((g) => g.length),
      prisma.supportMessage.count({ where: { fromAdmin: false, createdAt: { gte: since24h } } }),
    ]).then(([unread, total, last24h]) => ({ unread, total, last24h }));
  },
};

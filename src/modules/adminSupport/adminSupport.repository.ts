import type { Prisma } from '@prisma/client';
import { prisma } from '../../config/prisma.js';

function whereFor(q: string | undefined, status: 'all' | 'unread' | 'read'): Prisma.SupportMessageWhereInput {
  const where: Prisma.SupportMessageWhereInput = {};
  if (q) {
    where.OR = [
      { message: { contains: q, mode: 'insensitive' } },
      { user: { email: { contains: q, mode: 'insensitive' } } },
      { user: { displayName: { contains: q, mode: 'insensitive' } } },
    ];
  }
  if (status === 'unread') where.read = false;
  else if (status === 'read') where.read = true;
  return where;
}

const SELECT = {
  id: true,
  message: true,
  read: true,
  createdAt: true,
  user: { select: { id: true, email: true, displayName: true, avatarInitials: true } },
} satisfies Prisma.SupportMessageSelect;

export const adminSupportRepository = {
  async list(q: string | undefined, status: 'all' | 'unread' | 'read', page: number, pageSize: number) {
    const where = whereFor(q, status);
    const [rows, total] = await Promise.all([
      prisma.supportMessage.findMany({
        where,
        select: SELECT,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      prisma.supportMessage.count({ where }),
    ]);
    return { rows, total };
  },

  findById(id: string) {
    return prisma.supportMessage.findUnique({ where: { id }, select: SELECT });
  },

  /** Toggle lu/non lu — le bouton back-office affiche l'action inverse de l'état courant. */
  async toggleRead(id: string, nextRead: boolean, now: Date) {
    return prisma.supportMessage.update({
      where: { id },
      data: { read: nextRead, readAt: nextRead ? now : null },
      select: SELECT,
    });
  },

  summary(since24h: Date) {
    return Promise.all([
      prisma.supportMessage.count({ where: { read: false } }),
      prisma.supportMessage.count(),
      prisma.supportMessage.count({ where: { createdAt: { gte: since24h } } }),
    ]).then(([unread, total, last24h]) => ({ unread, total, last24h }));
  },
};

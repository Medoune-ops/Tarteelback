import type { Prisma, User } from '@prisma/client';
import { prisma } from '../../config/prisma.js';

const LIST_SELECT = {
  id: true,
  email: true,
  displayName: true,
  avatarInitials: true,
  weeklyXp: true,
  streak: true,
  hearts: true,
  lastHeartLossAt: true,
  gems: true,
  isPremium: true,
  premiumUntil: true,
  bannedAt: true,
  bannedReason: true,
  createdAt: true,
  leagueMemberships: {
    orderBy: { joinedAt: 'desc' as const },
    take: 1,
    select: { leagueWeek: { select: { league: { select: { nom: true, niveau: true } } } } },
  },
} satisfies Prisma.UserSelect;

export type AdminUserListRow = Prisma.UserGetPayload<{ select: typeof LIST_SELECT }>;

function whereFor(q: string | undefined, status: 'all' | 'premium' | 'free' | 'banned'): Prisma.UserWhereInput {
  const where: Prisma.UserWhereInput = {};
  if (q) {
    where.OR = [
      { email: { contains: q, mode: 'insensitive' } },
      { displayName: { contains: q, mode: 'insensitive' } },
    ];
  }
  if (status === 'premium') where.isPremium = true;
  else if (status === 'free') where.isPremium = false;
  else if (status === 'banned') where.bannedAt = { not: null };
  return where;
}

export const adminUsersRepository = {
  async list(q: string | undefined, status: 'all' | 'premium' | 'free' | 'banned', page: number, pageSize: number) {
    const where = whereFor(q, status);
    const [rows, total] = await Promise.all([
      prisma.user.findMany({
        where,
        select: LIST_SELECT,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      prisma.user.count({ where }),
    ]);
    return { rows, total };
  },

  findById(id: string): Promise<User | null> {
    return prisma.user.findUnique({ where: { id } });
  },

  ban(id: string, reason: string | undefined, when: Date) {
    return prisma.user.update({ where: { id }, data: { bannedAt: when, bannedReason: reason ?? null } });
  },

  unban(id: string) {
    return prisma.user.update({ where: { id }, data: { bannedAt: null, bannedReason: null } });
  },

  revokeAllSessions(userId: string, when: Date) {
    return prisma.refreshToken.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: when } });
  },

  grantHearts(id: string, hearts: number) {
    return prisma.user.update({ where: { id }, data: { hearts, lastHeartLossAt: hearts >= 5 ? null : undefined } });
  },

  /** Grants gems and writes the corresponding ledger row in the same transaction. */
  grantGems(id: string, amount: number) {
    return prisma.$transaction(async (tx) => {
      const user = await tx.user.update({ where: { id }, data: { gems: { increment: amount } } });
      await tx.gemTransaction.create({
        data: { userId: id, amount, reason: 'admin_grant', ref: null },
      });
      return user;
    });
  },

  grantPremium(id: string, premiumUntil: Date | null) {
    return prisma.user.update({
      where: { id },
      data: { isPremium: true, premiumUntil, personalPremiumUntil: premiumUntil },
    });
  },
};

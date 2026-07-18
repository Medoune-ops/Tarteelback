import type { Prisma } from '@prisma/client';
import { prisma } from '../../config/prisma.js';

const TX_SELECT = {
  id: true,
  userId: true,
  type: true,
  montant: true,
  devise: true,
  statut: true,
  providerRef: true,
  createdAt: true,
  user: { select: { email: true, displayName: true } },
} satisfies Prisma.TransactionSelect;

export type AdminTransactionRow = Prisma.TransactionGetPayload<{ select: typeof TX_SELECT }>;

export const adminMonetisationRepository = {
  async listTransactions(type: string, page: number, pageSize: number) {
    const where: Prisma.TransactionWhereInput =
      type === 'all' ? {} : { type: type as 'premium_subscription' | 'streak_repair' | 'gem_pack' | 'heart_pack' };
    const [rows, total] = await Promise.all([
      prisma.transaction.findMany({
        where,
        select: TX_SELECT,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      prisma.transaction.count({ where }),
    ]);
    return { rows, total };
  },

  /** Premium users actifs, avec juste ce qu'il faut pour dériver un plan (foyer ou individuel). */
  countActivePremiumUsers(now: Date) {
    return prisma.user.count({
      where: { isPremium: true, OR: [{ premiumUntil: null }, { premiumUntil: { gt: now } }] },
    });
  },

  /** Utilisateurs dont le premium personnel (indépendant du foyer) est encore actif — pour distinguer individuel/famille. */
  countActivePersonalPremiumUsers(now: Date) {
    return prisma.user.count({
      where: {
        isPremium: true,
        personalPremiumUntil: { gt: now },
      },
    });
  },

  countActiveHouseholds(now: Date) {
    return prisma.household.count({
      where: { subscriptionActive: true, subscriptionUntil: { gt: now } },
    });
  },

  /** Distinct members (owner inclus) rattachés à un foyer avec abonnement actif — pour le compte de sièges familiaux. */
  countHouseholdMembersWithActiveSub(now: Date) {
    return prisma.householdMember.count({
      where: { household: { subscriptionActive: true, subscriptionUntil: { gt: now } } },
    });
  },

  /** Comptes premium dont l'expiration tombe dans les `days` prochains jours (churn imminent). */
  countExpiringSoon(now: Date, until: Date) {
    return prisma.user.count({
      where: { isPremium: true, premiumUntil: { gt: now, lte: until } },
    });
  },

  countTotalUsers() {
    return prisma.user.count();
  },

  sumSuccessfulTransactions(since: Date) {
    return prisma.transaction.aggregate({
      where: { statut: 'success', createdAt: { gte: since } },
      _sum: { montant: true },
      _count: true,
    });
  },

  countGemTransactionsSince(since: Date) {
    return prisma.gemTransaction.count({ where: { createdAt: { gte: since } } });
  },
};

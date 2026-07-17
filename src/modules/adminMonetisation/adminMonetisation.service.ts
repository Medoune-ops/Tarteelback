import { env } from '../../config/env.js';
import { adminMonetisationRepository } from './adminMonetisation.repository.js';
import type { ListTransactionsQuery } from './adminMonetisation.schemas.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const EXPIRING_SOON_DAYS = 7;
// Fenêtre de calcul du MRR/ARPU : 30 jours glissants sur les transactions
// réussies (proxy simple faute d'un vrai cycle de facturation par abonné).
const REVENUE_WINDOW_DAYS = 30;

export const adminMonetisationService = {
  async listTransactions(query: ListTransactionsQuery) {
    const { rows, total } = await adminMonetisationRepository.listTransactions(query.type, query.page, query.pageSize);
    return {
      transactions: rows.map((t) => ({
        id: t.id,
        userId: t.userId,
        userEmail: t.user.email,
        userDisplayName: t.user.displayName,
        type: t.type,
        montant: Number(t.montant),
        devise: t.devise,
        statut: t.statut,
        providerRef: t.providerRef,
        createdAt: t.createdAt,
      })),
      pagination: { page: query.page, pageSize: query.pageSize, total, totalPages: Math.ceil(total / query.pageSize) },
    };
  },

  /**
   * KPIs dérivés de données réelles :
   * - MRR estimé = (abonnés individuels actifs × prix mensuel individuel) +
   *   (foyers actifs × prix mensuel famille), les plans annuels étant déjà
   *   matérialisés en premiumUntil/subscriptionUntil (pas de double-comptage —
   *   on compte des abonnements ACTIFS, pas des paiements du mois).
   * - ARPU = MRR / total premium actifs (sièges, foyer compté par membre).
   * - Chiffre d'affaires 30j = somme réelle des Transaction réussies.
   */
  async summary() {
    const now = new Date();
    const expiringUntil = new Date(now.getTime() + EXPIRING_SOON_DAYS * DAY_MS);
    const revenueWindowStart = new Date(now.getTime() - REVENUE_WINDOW_DAYS * DAY_MS);

    const [
      totalUsers,
      activePremiumUsers,
      activePersonalPremiumUsers,
      activeHouseholds,
      householdSeats,
      expiringSoon,
      revenue30d,
      gemTx30d,
    ] = await Promise.all([
      adminMonetisationRepository.countTotalUsers(),
      adminMonetisationRepository.countActivePremiumUsers(now),
      adminMonetisationRepository.countActivePersonalPremiumUsers(now),
      adminMonetisationRepository.countActiveHouseholds(now),
      adminMonetisationRepository.countHouseholdMembersWithActiveSub(now),
      adminMonetisationRepository.countExpiringSoon(now, expiringUntil),
      adminMonetisationRepository.sumSuccessfulTransactions(revenueWindowStart),
      adminMonetisationRepository.countGemTransactionsSince(revenueWindowStart),
    ]);

    const mrrEstimate =
      activePersonalPremiumUsers * env.PREMIUM_PRICE_MONTHLY + activeHouseholds * env.PREMIUM_PRICE_FAMILY_MONTHLY;
    const arpu = activePremiumUsers > 0 ? mrrEstimate / activePremiumUsers : 0;
    const premiumConversionPct = totalUsers > 0 ? Math.round((activePremiumUsers / totalUsers) * 1000) / 10 : 0;

    return {
      totalUsers,
      activePremiumUsers,
      activePersonalPremiumUsers,
      activeHouseholds,
      householdSeats,
      premiumConversionPct,
      mrrEstimate: Math.round(mrrEstimate * 100) / 100,
      arpu: Math.round(arpu * 100) / 100,
      expiringSoonCount: expiringSoon,
      expiringSoonDays: EXPIRING_SOON_DAYS,
      revenue30d: Number(revenue30d._sum.montant ?? 0),
      successfulTransactions30d: revenue30d._count,
      gemTransactions30d: gemTx30d,
      pricing: {
        monthly: env.PREMIUM_PRICE_MONTHLY,
        yearly: env.PREMIUM_PRICE_YEARLY,
        familyMonthly: env.PREMIUM_PRICE_FAMILY_MONTHLY,
        familyYearly: env.PREMIUM_PRICE_FAMILY_YEARLY,
        currency: env.BILLING_CURRENCY,
      },
    };
  },
};

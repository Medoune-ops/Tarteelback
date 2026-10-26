import { adminConfigRepository } from './adminConfig.repository.js';
import type { UpdateConfigBody } from './adminConfig.schemas.js';
import { isFriendsEnabled } from '../../core/friends.js';
import { prisma } from '../../config/prisma.js';
import { ensureFriendsConfigFresh, invalidateFriendsConfig } from '../../core/friendsConfig.js';

type ConfigRow = Awaited<ReturnType<typeof adminConfigRepository.get>>;

function serializePricing(row: ConfigRow) {
  return {
    premiumMonthlyPriceEur: row.premiumMonthlyPriceEur,
    premiumYearlyPriceEur: row.premiumYearlyPriceEur,
    premiumFamilyMonthlyPriceEur: row.premiumFamilyMonthlyPriceEur,
    premiumFamilyYearlyPriceEur: row.premiumFamilyYearlyPriceEur,
    streakRepairPriceEur: row.streakRepairPriceEur,
    heartRefillPriceEur: row.heartRefillPriceEur,
    gemPack500PriceEur: row.gemPack500PriceEur,
    gemPack3000PriceEur: row.gemPack3000PriceEur,
    gemPack7000PriceEur: row.gemPack7000PriceEur,
    gemCostHeartRefill: row.gemCostHeartRefill,
    gemCostStreakFreeze: row.gemCostStreakFreeze,
    gemCostDoubleXp: row.gemCostDoubleXp,
  };
}

/**
 * GET /config (public, pas d'auth) — l'app le lit avant connexion pour
 * afficher les VRAIS prix (déjà publiquement visibles dans l'app de toute
 * façon, comme n'importe quel prix affiché en boutique) et savoir si les
 * paiements doivent rester masqués. Seule L'ÉCRITURE (PATCH) est protégée
 * (admin only) — voir serializeAdmin/adminConfig.routes.ts.
 */
function serializePublic(row: ConfigRow) {
  return {
    paymentsEnabled: row.paymentsEnabled,
    // Interrupteur back-office (AppConfig) — l'app le lit ici pour savoir si
    // elle doit afficher l'écran de vérification par code après l'inscription.
    emailVerificationEnabled: row.emailVerificationEnabled,
    pricing: serializePricing(row),
    updatedAt: row.updatedAt,
  };
}

/** GET/PATCH /backoffice/config (admin) — même forme, réservée aux admins pour l'écriture. */
function serializeAdmin(row: ConfigRow) {
  return {
    paymentsEnabled: row.paymentsEnabled,
    globalPremiumPromoActive: row.globalPremiumPromoActive,
    emailVerificationEnabled: row.emailVerificationEnabled,
    pricing: serializePricing(row),
    friends: {
      friendsEnabled: row.friendsEnabled,
      friendsBetaUserIds: row.friendsBetaUserIds,
      challengeRewardsEnabled: row.challengeRewardsEnabled,
      challengeWinGems: row.challengeWinGems,
      challengeCompleteGems: row.challengeCompleteGems,
      challengeRewardedPerWeek: row.challengeRewardedPerWeek,
      messagesPerDayFree: row.messagesPerDayFree,
      messagesPerDayPremium: row.messagesPerDayPremium,
    },
    updatedAt: row.updatedAt,
  };
}

export const adminConfigService = {
  /** GET /config (public) */
  async getPublic(userId?: string | null) {
    const row = await adminConfigRepository.get();
    await ensureFriendsConfigFresh();
    // Compte coupé par la modération : l'app masque la fonctionnalité.
    const cut = userId
      ? (await prisma.user.findUnique({ where: { id: userId }, select: { friendsDisabledAt: true } }))
          ?.friendsDisabledAt
      : null;
    return {
      ...serializePublic(row),
      friendsEnabled: isFriendsEnabled(userId) && !cut,
    };
  },

  /** GET /backoffice/config */
  async getAdmin() {
    return serializeAdmin(await adminConfigRepository.get());
  },

  /** PATCH /backoffice/config */
  async update(body: UpdateConfigBody) {
    const row = await adminConfigRepository.update(body);
    invalidateFriendsConfig();
    return serializeAdmin(row);
  },
};

/** Lecture interne (billing/gem services) — pas de sérialisation HTTP. */
export async function getPricingConfig() {
  return adminConfigRepository.get();
}

/** Lecture interne (auth.service.ts) — interrupteur back-office, jamais mis en cache. */
export async function isEmailVerificationEnabled(): Promise<boolean> {
  const row = await adminConfigRepository.get();
  return row.emailVerificationEnabled;
}




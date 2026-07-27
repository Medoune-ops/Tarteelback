import { adminConfigRepository } from './adminConfig.repository.js';
import type { UpdateConfigBody } from './adminConfig.schemas.js';

type ConfigRow = Awaited<ReturnType<typeof adminConfigRepository.get>>;

/** GET /config (public, pas d'auth) — UNIQUEMENT ce que l'app a besoin de lire
 *  avant connexion. Ne JAMAIS y exposer les prix : ce serait public/scrapable. */
function serializePublic(row: ConfigRow) {
  return { paymentsEnabled: row.paymentsEnabled, updatedAt: row.updatedAt };
}

/** GET/PATCH /backoffice/config (admin) — la tarification complète. */
function serializeAdmin(row: ConfigRow) {
  return {
    paymentsEnabled: row.paymentsEnabled,
    pricing: {
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
    },
    updatedAt: row.updatedAt,
  };
}

export const adminConfigService = {
  /** GET /config (public) */
  async getPublic() {
    return serializePublic(await adminConfigRepository.get());
  },

  /** GET /backoffice/config */
  async getAdmin() {
    return serializeAdmin(await adminConfigRepository.get());
  },

  /** PATCH /backoffice/config */
  async update(body: UpdateConfigBody) {
    return serializeAdmin(await adminConfigRepository.update(body));
  },
};

/** Lecture interne (billing/gem services) — pas de sérialisation HTTP. */
export async function getPricingConfig() {
  return adminConfigRepository.get();
}

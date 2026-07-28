import { adminConfigRepository } from './adminConfig.repository.js';
import type { UpdateConfigBody } from './adminConfig.schemas.js';

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
    pricing: serializePricing(row),
    updatedAt: row.updatedAt,
  };
}

/** GET/PATCH /backoffice/config (admin) — même forme, réservée aux admins pour l'écriture. */
function serializeAdmin(row: ConfigRow) {
  return {
    paymentsEnabled: row.paymentsEnabled,
    pricing: serializePricing(row),
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

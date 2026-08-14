import { z } from 'zod';

const priceEur = z.number().positive();
const gemCost = z.number().int().positive();

export const updateConfigBodySchema = z.object({
  paymentsEnabled: z.boolean().optional(),
  // "Premium gratuit pour tous" (event-style, ex: Ramadan) — voir core/premium.ts
  // et me.service.ts::syncUserState pour la résolution. Réévalué à chaque sync :
  // aucun bulk-update de la table User, donc s'applique aussi aux inscriptions
  // faites pendant que c'est actif, et se coupe pour tous instantanément à la
  // désactivation, SANS jamais toucher aux abonnés ayant réellement payé.
  globalPremiumPromoActive: z.boolean().optional(),

  // Vérification d'email à l'inscription — voir adminConfig.service.ts pour
  // le comportement ON/OFF. Ne touche jamais les comptes déjà créés.
  emailVerificationEnabled: z.boolean().optional(),

  // Tarification — toute valeur omise reste inchangée (upsert partiel).
  premiumMonthlyPriceEur: priceEur.optional(),
  premiumYearlyPriceEur: priceEur.optional(),
  premiumFamilyMonthlyPriceEur: priceEur.optional(),
  premiumFamilyYearlyPriceEur: priceEur.optional(),
  streakRepairPriceEur: priceEur.optional(),
  heartRefillPriceEur: priceEur.optional(),
  gemPack500PriceEur: priceEur.optional(),
  gemPack3000PriceEur: priceEur.optional(),
  gemPack7000PriceEur: priceEur.optional(),
  gemCostHeartRefill: gemCost.optional(),
  gemCostStreakFreeze: gemCost.optional(),
  gemCostDoubleXp: gemCost.optional(),
});

export type UpdateConfigBody = z.infer<typeof updateConfigBodySchema>;

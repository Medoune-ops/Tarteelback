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

  // Fonctions entre amis — interrupteur sans redéploiement (appliqué en 10 s).
  friendsEnabled: z.boolean().optional(),
  // Non vide : la fonctionnalité n'est ouverte qu'à ces comptes. [] = tout le monde.
  friendsBetaUserIds: z.array(z.string().trim().min(1)).max(1000).optional(),
  challengeRewardsEnabled: z.boolean().optional(),
  challengeWinGems: z.number().int().min(0).max(10_000).optional(),
  challengeCompleteGems: z.number().int().min(0).max(10_000).optional(),
  challengeRewardedPerWeek: z.number().int().min(0).max(100).optional(),
  messagesPerDayFree: z.number().int().min(0).max(1000).optional(),
  messagesPerDayPremium: z.number().int().min(0).max(1000).optional(),
});

export type UpdateConfigBody = z.infer<typeof updateConfigBodySchema>;

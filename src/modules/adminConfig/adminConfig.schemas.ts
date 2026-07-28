import { z } from 'zod';

const priceEur = z.number().positive();
const gemCost = z.number().int().positive();

export const updateConfigBodySchema = z.object({
  paymentsEnabled: z.boolean().optional(),

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

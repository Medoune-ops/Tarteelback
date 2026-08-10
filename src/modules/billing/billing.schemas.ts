import { z } from 'zod';

/**
 * Choix du provider de paiement fait par l'utilisateur côté app :
 * - 'dexpay' = Mobile Money (Wave, Orange Money, MTN, Moov…), Afrique de
 *   l'Ouest/Centrale uniquement.
 * - 'stripe' = carte bancaire, couverture mondiale.
 * Défaut 'dexpay' pour ne pas casser les clients mobiles pas encore mis à
 * jour (qui n'envoient pas encore ce champ).
 */
export const paymentProviderSchema = z.enum(['dexpay', 'stripe']).default('dexpay');

export const subscribeSchema = z
  .object({
    // Plans individuels (mensuel/annuel) et familiaux (jusqu'à 5 comptes).
    plan: z.enum(['mensuel', 'annuel', 'famille_mensuel', 'famille_annuel']),
    provider: paymentProviderSchema,
    // Mock provider token; in a real Stripe flow this would be a PaymentMethod id.
    paymentToken: z.string().optional(),
  })
  .strict();

export type SubscribeInput = z.infer<typeof subscribeSchema>;

export const buyGemsSchema = z
  .object({
    pack: z.enum(['p500', 'p3000', 'p7000']),
    provider: paymentProviderSchema,
    paymentToken: z.string().optional(),
  })
  .strict();

export type BuyGemsInput = z.infer<typeof buyGemsSchema>;

export const buyHeartsSchema = z
  .object({
    // Achat d'un refill complet des cœurs (montant fixe côté serveur).
    provider: paymentProviderSchema,
    paymentToken: z.string().optional(),
  })
  .strict();

export type BuyHeartsInput = z.infer<typeof buyHeartsSchema>;

export const repairStreakSchema = z
  .object({
    provider: paymentProviderSchema,
  })
  .strict();

export type RepairStreakInput = z.infer<typeof repairStreakSchema>;

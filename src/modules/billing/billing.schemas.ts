import { z } from 'zod';

export const subscribeSchema = z
  .object({
    plan: z.enum(['mensuel', 'annuel']),
    // Mock provider token; in a real Stripe flow this would be a PaymentMethod id.
    paymentToken: z.string().optional(),
  })
  .strict();

export type SubscribeInput = z.infer<typeof subscribeSchema>;

export const buyGemsSchema = z
  .object({
    pack: z.enum(['p500', 'p3000', 'p7000']),
    paymentToken: z.string().optional(),
  })
  .strict();

export type BuyGemsInput = z.infer<typeof buyGemsSchema>;

import { z } from 'zod';

export const subscribeSchema = z
  .object({
    plan: z.enum(['mensuel', 'annuel']),
    // Mock provider token; in a real Stripe flow this would be a PaymentMethod id.
    paymentToken: z.string().optional(),
  })
  .strict();

export type SubscribeInput = z.infer<typeof subscribeSchema>;

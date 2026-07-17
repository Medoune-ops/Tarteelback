import { z } from 'zod';

/** GET /backoffice/monetisation/transactions — pagination + optional type filter. */
export const listTransactionsQuerySchema = z
  .object({
    type: z.enum(['all', 'premium_subscription', 'streak_repair', 'gem_pack', 'heart_pack']).default('all'),
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(20),
  })
  .strict();

export type ListTransactionsQuery = z.infer<typeof listTransactionsQuerySchema>;

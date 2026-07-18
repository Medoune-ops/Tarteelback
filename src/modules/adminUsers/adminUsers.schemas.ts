import { z } from 'zod';

/** GET /admin/users — search + filter + pagination. */
export const listUsersQuerySchema = z
  .object({
    q: z.string().trim().max(200).optional(), // matches email or displayName (contains, case-insensitive)
    status: z.enum(['all', 'premium', 'free', 'banned']).default('all'),
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(20),
  })
  .strict();

export const banUserSchema = z
  .object({
    reason: z.string().trim().min(1).max(300).optional(),
  })
  .strict();

/** POST /admin/users/:id/grant-hearts — amount is added, capped at MAX_HEARTS server-side. */
export const grantHeartsSchema = z
  .object({
    amount: z.number().int().min(1).max(5),
  })
  .strict();

/** POST /admin/users/:id/grant-gems — amount is added to the balance (ledgered). */
export const grantGemsSchema = z
  .object({
    amount: z.number().int().min(1).max(1_000_000),
  })
  .strict();

/** POST /admin/users/:id/grant-premium — duration in days, or "lifetime". */
export const grantPremiumSchema = z
  .object({
    durationDays: z.union([z.number().int().min(1).max(3650), z.literal('lifetime')]),
  })
  .strict();

export type ListUsersQuery = z.infer<typeof listUsersQuerySchema>;
export type BanUserInput = z.infer<typeof banUserSchema>;
export type GrantHeartsInput = z.infer<typeof grantHeartsSchema>;
export type GrantGemsInput = z.infer<typeof grantGemsSchema>;
export type GrantPremiumInput = z.infer<typeof grantPremiumSchema>;

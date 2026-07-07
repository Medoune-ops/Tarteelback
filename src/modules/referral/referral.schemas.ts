import { z } from 'zod';

export const redeemReferralSchema = z
  .object({
    code: z.string().min(4).max(16),
  })
  .strict();

export type RedeemReferralInput = z.infer<typeof redeemReferralSchema>;

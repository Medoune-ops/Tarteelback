import { z } from 'zod';

const targetSchema = z.union([
  z.object({ segment: z.enum(['all', 'premium', 'free', 'banned']) }).strict(),
  z.object({ userIds: z.array(z.string().min(1)).min(1).max(5000) }).strict(),
]);

const giftSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('hearts'), amount: z.number().int().min(1).max(5) }).strict(),
  z.object({ kind: z.literal('gems'), amount: z.number().int().min(1).max(1_000_000) }).strict(),
  z.object({
    kind: z.literal('premium'),
    durationDays: z.union([z.number().int().min(1).max(3650), z.literal('lifetime')]),
  }).strict(),
]);

/** POST /backoffice/gifts/bulk-grant */
export const bulkGrantSchema = z
  .object({
    target: targetSchema,
    gift: giftSchema,
  })
  .strict();

export type BulkGrantInput = z.infer<typeof bulkGrantSchema>;

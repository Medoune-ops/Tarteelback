import { z } from 'zod';

export const updateConfigBodySchema = z.object({
  paymentsEnabled: z.boolean().optional(),
});

export type UpdateConfigBody = z.infer<typeof updateConfigBodySchema>;

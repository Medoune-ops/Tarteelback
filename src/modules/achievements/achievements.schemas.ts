import { z } from 'zod';

export const achievementListQuerySchema = z
  .object({
    since: z.string().datetime().optional(),
  })
  .strict();

export const achievementReactionParamsSchema = z.object({
  id: z.string().min(1),
}).strict();

export const achievementReactionBodySchema = z.object({
  kind: z.enum(['mashaallah', 'barakallah', 'dua', 'bravo']),
}).strict();

import { z } from 'zod';

export const reviewRegainSchema = z
  .object({
    numero: z.number().int().positive(),
  })
  .strict();

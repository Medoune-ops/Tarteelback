import { z } from 'zod';

export const reviewSchema = z
  .object({
    quality: z.enum(['facile', 'difficile', 'oublie']),
  })
  .strict();

import { z } from 'zod';

export const reviewSchema = z
  .object({
    quality: z.enum(['facile', 'difficile', 'oublie']),
  })
  .strict();

/** Body de POST /revisions/:idOrNumero/guided/advance — même auto-évaluation
 * que le SRS par segment ; sert à décider si on avance le curseur ou si on
 * répète le cycle courant. */
export const guidedAdvanceSchema = z
  .object({
    quality: z.enum(['facile', 'difficile', 'oublie']),
  })
  .strict();

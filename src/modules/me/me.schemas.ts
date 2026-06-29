import { z } from 'zod';
import { isValidTimezone } from '../../core/streak.js';

/** Reusable IANA-timezone validator (rejects "Mars/Phobos", prevents the
 *  500-forever bug where a bad tz breaks every streak computation). */
export const timezoneSchema = z
  .string()
  .min(1)
  .max(64)
  .refine(isValidTimezone, { message: 'Invalid IANA timezone' });

/**
 * Profile fields the user may update from the app (onboarding & settings).
 * `.strict()` rejects any unknown key (400) — defence against mass-assignment:
 * a client cannot smuggle `isPremium`, `role`, `xp`, `hearts`, etc. into the
 * update. Only the whitelisted fields below are ever writable here.
 */
export const updateMeSchema = z
  .object({
    displayName: z.string().min(1).max(80).optional(),
    level: z.enum(['debutant', 'alphabet', 'lent', 'fluent']).optional(),
    objectif: z.enum(['lire', 'hifz', 'tafsir', 'complet']).optional(),
    dailyMinutes: z.number().int().min(1).max(600).optional(),
    onboardingDone: z.boolean().optional(),
    timezone: timezoneSchema.optional(),
    language: z.string().min(2).max(10).optional(),
  })
  .strict()
  .refine((o) => Object.keys(o).length > 0, { message: 'No fields to update' });

export type UpdateMeInput = z.infer<typeof updateMeSchema>;

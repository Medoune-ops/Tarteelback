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
 * Pseudo public (affiché dans les ligues à la place du nom complet).
 * 3–20 caractères, lettres/chiffres/point/underscore, normalisé en minuscules.
 * Optionnel côté API (comptes existants) — l'affichage retombe sur
 * displayName quand absent.
 */
export const usernameSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9._]{3,20}$/, 'Username: 3-20 chars, letters/digits/._ only');

/**
 * Profile fields the user may update from the app (onboarding & settings).
 * `.strict()` rejects any unknown key (400) — defence against mass-assignment:
 * a client cannot smuggle `isPremium`, `role`, `xp`, `hearts`, etc. into the
 * update. Only the whitelisted fields below are ever writable here.
 */
export const updateMeSchema = z
  .object({
    displayName: z.string().min(1).max(80).optional(),
    username: usernameSchema.optional(),
    level: z.enum(['debutant', 'alphabet', 'lent', 'fluent']).optional(),
    objectif: z.enum(['lire', 'hifz', 'tafsir', 'complet']).optional(),
    dailyMinutes: z.number().int().min(1).max(600).optional(),
    onboardingDone: z.boolean().optional(),
    timezone: timezoneSchema.optional(),
    language: z.string().min(2).max(10).optional(),
    // Onboarding only: numéros (1–114) des sourates déjà mémorisées. Non stocké
    // sur User — sert à pré-marquer les leçons correspondantes comme acquises
    // (skip du point de départ). Extrait avant l'update User dans le service.
    sourates: z.array(z.number().int().min(1).max(114)).max(114).optional(),
  })
  .strict()
  .refine((o) => Object.keys(o).length > 0, { message: 'No fields to update' });

export type UpdateMeInput = z.infer<typeof updateMeSchema>;

/**
 * PATCH /me/settings — app preferences (Settings screen). Separate from the
 * profile update so the front can hit a dedicated endpoint per BACKEND.md.
 * Also `.strict()` against mass-assignment.
 */
export const updateSettingsSchema = z
  .object({
    voiceEnabled: z.boolean().optional(),
    language: z.enum(['fr', 'en', 'ar']).optional(),
  })
  .strict()
  .refine((o) => Object.keys(o).length > 0, { message: 'No fields to update' });

export type UpdateSettingsInput = z.infer<typeof updateSettingsSchema>;

/**
 * DELETE /me — re-authentification obligatoire : un access token volé (15 min)
 * ne doit PAS suffire à détruire un compte. Le mot de passe est vérifié côté
 * service quand le compte en possède un.
 */
export const deleteMeSchema = z
  .object({ password: z.string().min(1).max(200).optional() })
  .strict();

export type DeleteMeInput = z.infer<typeof deleteMeSchema>;

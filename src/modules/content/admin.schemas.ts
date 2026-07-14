import { z } from 'zod';

// All admin inputs are `.strict()` too — unknown keys are rejected so no stray
// Prisma column can be injected even with an admin token.

/**
 * Texte i18n obligatoire — {fr, en}, jamais une string nue. Résolu à la
 * lecture par `resolveI18n()` (content.serializer.ts) selon la langue de
 * l'appelant. Voir schema.prisma pour la règle générale : tout NOUVEAU champ
 * texte lu par l'utilisateur doit passer par ce schéma (ou une table séparée
 * par langue), jamais un `z.string()` "en attendant" — c'est précisément ce
 * relâchement qui a laissé passer des titres non traduits en production.
 */
const i18nText = z.object({ fr: z.string().min(1), en: z.string().min(1) }).strict();

// ── Section ──
export const sectionCreateSchema = z
  .object({
    ordre: z.number().int().positive(),
    hizb: z.number().int().nullable().optional(),
    kicker: z.string().min(1),
    titre: i18nText,
    sousTitre: i18nText.optional(),
    couleur: z.string().min(1),
    degradeStart: z.string().min(1),
    degradeEnd: z.string().min(1),
    headerIcon: z.string().min(1),
    sourateNumeros: z.array(z.number().int()).optional(), // link by surah number
  })
  .strict();
export const sectionUpdateSchema = sectionCreateSchema.partial();

// ── Lesson ──
export const lessonCreateSchema = z
  .object({
    sectionId: z.string().min(1),
    ordre: z.number().int().positive(),
    titre: i18nText,
    iconType: z.string().default('star'),
  })
  .strict();
export const lessonUpdateSchema = lessonCreateSchema.partial();

// ── Lesson step ── (payload validated by type)
const discoveryPayload = z.object({
  arabe: z.string().min(1),
  translitteration: z.string().default(''),
  traduction: i18nText.optional(),
  audioUrl: z.string().url().nullable().optional(),
});
const writtenPayload = z.object({
  consigne: i18nText,
  arabe: z.string().min(1),
  translitteration: z.string().optional(),
  options: z.array(z.object({ id: z.string(), text: z.string() })).min(2),
  bonneReponse: z.string().min(1),
});
const voicePayload = z.object({
  arabe: z.string().min(1),
  translitteration: z.string().default(''),
  traduction: i18nText.optional(),
  audioUrl: z.string().url().nullable().optional(),
  seuilReussite: z.number().int().min(0).max(100).default(70),
});

export const stepCreateSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('discovery'), lessonId: z.string(), ordre: z.number().int(), payload: discoveryPayload }),
  z.object({ type: z.literal('written'), lessonId: z.string(), ordre: z.number().int(), payload: writtenPayload }),
  z.object({ type: z.literal('voice'), lessonId: z.string(), ordre: z.number().int(), payload: voicePayload }),
]);

// ── Sourate ──
export const sourateCreateSchema = z
  .object({
    numero: z.number().int().min(1).max(114),
    nom: z.string().min(1),
    nomArabe: z.string().min(1),
    nombreVersets: z.number().int().positive(),
    hizb: z.number().int().min(1).max(60),
    revelation: z.string().optional(),
  })
  .strict();
export const sourateUpdateSchema = sourateCreateSchema.partial();

// ── Verset (+ per-language translation/transliteration) ──
export const versetCreateSchema = z
  .object({
    sourateId: z.string().min(1),
    numero: z.number().int().positive(),
    texteArabe: z.string().min(1),
    audioUrl: z.string().url().nullable().optional(),
    traductions: z
      .array(z.object({ langue: z.string(), texte: z.string(), source: z.string() }).strict())
      .optional(),
    translitterations: z
      .array(z.object({ langue: z.string(), texte: z.string(), source: z.string() }).strict())
      .optional(),
  })
  .strict();
export const versetUpdateSchema = versetCreateSchema.partial();

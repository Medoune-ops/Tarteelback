import 'dotenv/config';
import { z } from 'zod';

/**
 * Centralised, validated environment configuration.
 * The process refuses to boot if a required variable is missing/invalid.
 */
const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  HOST: z.string().default('0.0.0.0'),
  CORS_ORIGINS: z.string().default('*'),

  DATABASE_URL: z.string().min(1),

  // Optional. When set, enables distributed rate-limit, content cache, league
  // sorted-sets and distributed locks. When absent, the app degrades to
  // in-memory rate-limit + SQL-only ranking (single-instance friendly).
  REDIS_URL: z
    .string()
    .trim()
    .optional()
    .transform((v) => (v ? v : undefined)),
  // Bump to invalidate ALL cached content at once (also bumped automatically on
  // admin writes via a Redis counter).
  CONTENT_CACHE_TTL_SECONDS: z.coerce.number().int().positive().default(3600),

  JWT_ACCESS_SECRET: z.string().min(32),
  JWT_REFRESH_SECRET: z.string().min(32),
  ACCESS_TOKEN_TTL: z.string().default('15m'),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(90),

  // Back-office (web admin panel) — a *different* secret from the mobile app's,
  // plus a distinct JWT audience (see plugins/adminAuth.ts), so a leaked mobile
  // access token can never be replayed against back-office routes or vice versa.
  JWT_ADMIN_ACCESS_SECRET: z.string().min(32),
  ADMIN_ACCESS_TOKEN_TTL: z.string().default('15m'),
  // Shorter-lived than the mobile 90-day window: back-office sessions carry
  // more blast radius per compromised device (can ban users, edit prices...).
  ADMIN_REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(14),

  MAX_HEARTS: z.coerce.number().int().positive().default(5),
  HEART_REGEN_MS: z.coerce.number().int().positive().default(60 * 60 * 1000),
  PREMIUM_XP_MULTIPLIER: z.coerce.number().int().positive().default(2),

  DEFAULT_LANG: z.string().default('en'),

  QURAN_API_BASE: z.string().default('https://api.quran.com/api/v4'),
  QURAN_TRANSLATION_IDS: z.string().default('131,136'),
  QURAN_TRANSLATION_LANGS: z.string().default('131:en,136:fr'),
  QURAN_TRANSLITERATION_ID: z.coerce.number().int().default(57),
  QURAN_RECITATION_ID: z.coerce.number().int().default(7),
  // Empty string in .env means "no limit" -> undefined.
  QURAN_IMPORT_LIMIT: z
    .string()
    .trim()
    .optional()
    .transform((v) => (v ? Number(v) : undefined))
    .pipe(z.number().int().positive().optional()),

  // Password reset email (Resend). When RESEND_API_KEY is unset, the reset link
  // is logged instead of emailed (dev-friendly; never silently fails).
  RESEND_API_KEY: z
    .string()
    .trim()
    .optional()
    .transform((v) => (v ? v : undefined)),
  MAIL_FROM: z.string().default('Tarteel <onboarding@resend.dev>'),
  // Base URL of the app for building the reset link (deep link or web).
  APP_RESET_URL: z.string().default('tarteel://reset-password'),
  // Reset-token lifetime.
  PASSWORD_RESET_TTL_MINUTES: z.coerce.number().int().positive().default(30),

  // ASR serveur (microservice asr/ — Whisper base fine-tuné Coran). Optionnel :
  // quand ASR_URL est absent, les étapes voice gardent le chemin client
  // indulgent (score on-device, jamais de coeur en jeu).
  ASR_URL: z
    .string()
    .trim()
    .optional()
    .transform((v) => (v ? v.replace(/\/+$/, '') : undefined)),
  ASR_API_KEY: z
    .string()
    .trim()
    .optional()
    .transform((v) => (v ? v : undefined)),
  ASR_TIMEOUT_MS: z.coerce.number().int().positive().default(15_000),

  PREMIUM_PRICE_MONTHLY: z.coerce.number().default(1.52),
  PREMIUM_PRICE_YEARLY: z.coerce.number().default(15.24),
  // Plan familial (jusqu'à 5 comptes premium sous un même foyer).
  PREMIUM_PRICE_FAMILY_MONTHLY: z.coerce.number().default(3.99),
  PREMIUM_PRICE_FAMILY_YEARLY: z.coerce.number().default(39.99),
  STREAK_REPAIR_PRICE: z.coerce.number().default(0.87),
  // Prix d'un refill complet des cœurs payé avec de l'argent (paiement mock).
  HEART_REFILL_PRICE: z.coerce.number().default(0.99),
  BILLING_CURRENCY: z.string().default('EUR'),
});

const parsed = EnvSchema.safeParse(process.env);

if (!parsed.success) {
  // eslint-disable-next-line no-console
  console.error('❌ Invalid environment configuration:');
  // eslint-disable-next-line no-console
  console.error(parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parsed.data;
export type Env = typeof env;

export const isProd = env.NODE_ENV === 'production';
export const isTest = env.NODE_ENV === 'test';

/**
 * Production hardening: refuse to boot with placeholder secrets, a wildcard
 * CORS, or the mock billing provider. These are fine in dev but catastrophic
 * in prod (forgeable admin tokens, cross-origin credentialed requests, free
 * premium). Fail fast and loud.
 */
if (isProd) {
  const weak = /change-me|secret|example|placeholder/i;
  const problems: string[] = [];
  if (weak.test(env.JWT_ACCESS_SECRET)) problems.push('JWT_ACCESS_SECRET looks like a default/placeholder');
  if (weak.test(env.JWT_REFRESH_SECRET)) problems.push('JWT_REFRESH_SECRET looks like a default/placeholder');
  if (env.JWT_ACCESS_SECRET === env.JWT_REFRESH_SECRET) problems.push('JWT access and refresh secrets must differ');
  if (weak.test(env.JWT_ADMIN_ACCESS_SECRET)) problems.push('JWT_ADMIN_ACCESS_SECRET looks like a default/placeholder');
  if (env.JWT_ADMIN_ACCESS_SECRET === env.JWT_ACCESS_SECRET || env.JWT_ADMIN_ACCESS_SECRET === env.JWT_REFRESH_SECRET) {
    problems.push('JWT_ADMIN_ACCESS_SECRET must differ from the mobile app secrets');
  }
  if (env.CORS_ORIGINS.split(',').map((o) => o.trim()).includes('*')) {
    problems.push('CORS_ORIGINS=* is forbidden in production — set an explicit allow-list');
  }
  if (problems.length) {
    // eslint-disable-next-line no-console
    console.error('❌ Refusing to boot in production:\n - ' + problems.join('\n - '));
    process.exit(1);
  }
}

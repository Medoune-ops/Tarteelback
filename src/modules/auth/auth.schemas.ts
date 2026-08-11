import { z } from 'zod';
import { timezoneSchema, usernameSchema } from '../me/me.schemas.js';

// A device id ties a refresh token to one app installation. The RN app should
// generate a stable id (e.g. expo-application/installationId) and reuse it.
const deviceId = z.string().min(1).max(200);

// All auth inputs are `.strict()` — unknown keys are rejected (no role/premium
// injection at signup, etc.).
export const registerSchema = z
  .object({
    email: z.string().email().toLowerCase(),
    password: z.string().min(8).max(128),
    displayName: z.string().min(1).max(80),
    username: usernameSchema.optional(),
    deviceId,
    timezone: timezoneSchema.optional(),
    language: z.string().min(2).max(10).optional(),
  })
  .strict();

export const loginSchema = z
  .object({
    email: z.string().email().toLowerCase(),
    password: z.string().min(1).max(128),
    deviceId,
  })
  .strict();

export const refreshSchema = z
  .object({
    refreshToken: z.string().min(1),
    deviceId,
  })
  .strict();

export const logoutSchema = z
  .object({
    refreshToken: z.string().min(1).optional(),
    deviceId: deviceId.optional(),
    /** revoke every session of the user, not just this device. */
    allDevices: z.boolean().optional(),
  })
  .strict();

/** POST /auth/change-password — authenticated; requires the current password. */
export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1).max(128),
    newPassword: z.string().min(8).max(128),
  })
  .strict();

/** POST /auth/reset-password/request — start a reset by email. */
export const resetRequestSchema = z
  .object({
    email: z.string().email().toLowerCase(),
  })
  .strict();

/** POST /auth/reset-password/confirm — finish a reset with the emailed token. */
export const resetConfirmSchema = z
  .object({
    token: z.string().min(1),
    newPassword: z.string().min(8).max(128),
  })
  .strict();

/**
 * POST /auth/verify-email — feature-flagged (EMAIL_VERIFICATION_ENABLED),
 * see auth.service.ts. `email` (not an auth token) because this is called
 * right after register, before the user necessarily has a session on THIS
 * device confirmed (e.g. code requested again from another screen).
 *
 * Accepts `code` or `verificationCode` (front alias), trims spaces, and
 * coerces numeric input. `deviceId` is optional — when omitted the API
 * reuses the latest active session's deviceId from register/login.
 */
function normalizeVerificationCode(raw: unknown): string | undefined {
  if (raw === undefined || raw === null || raw === '') return undefined;
  if (Array.isArray(raw)) {
    return normalizeVerificationCode(raw.join(''));
  }
  const code = String(raw).replace(/\s/g, '');
  return /^\d{4}$/.test(code) ? code : undefined;
}

export const verifyEmailSchema = z
  .object({
    email: z.string().email().toLowerCase(),
    code: z.union([z.string(), z.number(), z.array(z.union([z.string(), z.number()]))]).optional(),
    verificationCode: z.union([z.string(), z.number(), z.array(z.union([z.string(), z.number()]))]).optional(),
    otp: z.union([z.string(), z.number(), z.array(z.union([z.string(), z.number()]))]).optional(),
    deviceId: deviceId.optional(),
  })
  .strict()
  .superRefine((data, ctx) => {
    if (!normalizeVerificationCode(data.code ?? data.verificationCode ?? data.otp)) {
      ctx.addIssue({
        code: 'custom',
        message: 'Code must be 4 digits',
        path: ['code'],
      });
    }
  })
  .transform((data) => ({
    email: data.email,
    code: normalizeVerificationCode(data.code ?? data.verificationCode ?? data.otp)!,
    deviceId: data.deviceId,
  }));

/** POST /auth/verify-email/resend — re-send a fresh code (invalidates the previous one). */
export const resendVerificationSchema = z
  .object({
    email: z.string().email().toLowerCase(),
  })
  .strict();

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type RefreshInput = z.infer<typeof refreshSchema>;
export type LogoutInput = z.infer<typeof logoutSchema>;
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;
export type ResetRequestInput = z.infer<typeof resetRequestSchema>;
export type ResetConfirmInput = z.infer<typeof resetConfirmSchema>;
export type VerifyEmailInput = z.infer<typeof verifyEmailSchema>;
export type ResendVerificationInput = z.infer<typeof resendVerificationSchema>;

import { z } from 'zod';
import { timezoneSchema } from '../me/me.schemas.js';

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

/** POST /auth/oauth — social sign-in via a provider id_token (native flow). */
export const oauthSchema = z
  .object({
    provider: z.literal('google'),
    idToken: z.string().min(1),
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

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type RefreshInput = z.infer<typeof refreshSchema>;
export type OAuthInput = z.infer<typeof oauthSchema>;
export type LogoutInput = z.infer<typeof logoutSchema>;
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;
export type ResetRequestInput = z.infer<typeof resetRequestSchema>;
export type ResetConfirmInput = z.infer<typeof resetConfirmSchema>;

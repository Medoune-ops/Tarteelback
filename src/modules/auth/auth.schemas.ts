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

export const logoutSchema = z
  .object({
    refreshToken: z.string().min(1).optional(),
    deviceId: deviceId.optional(),
    /** revoke every session of the user, not just this device. */
    allDevices: z.boolean().optional(),
  })
  .strict();

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type RefreshInput = z.infer<typeof refreshSchema>;
export type LogoutInput = z.infer<typeof logoutSchema>;

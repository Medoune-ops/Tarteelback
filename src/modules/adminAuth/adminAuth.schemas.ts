import { z } from 'zod';

// Ties a back-office refresh token to one browser/device — same notion as the
// mobile app's RefreshToken.deviceId (see core/tokens.ts). The front should
// generate a stable id (e.g. a random UUID persisted in localStorage) and
// reuse it across the session.
const deviceId = z.string().min(1).max(200);

const adminModuleSchema = z.enum([
  'overview',
  'users',
  'content',
  'monetization',
  'analytics',
  'push_announcements',
  'team',
]);

/** One row of the invite modal's permission grid. `canEdit` implies `canView`. */
const permissionInput = z
  .object({
    module: adminModuleSchema,
    canView: z.boolean(),
    canEdit: z.boolean(),
  })
  .strict()
  .refine((p) => p.canView || !p.canEdit, {
    message: 'canEdit requires canView',
    path: ['canEdit'],
  });

// All inputs are `.strict()` — unknown keys rejected (no isOwner injection at
// login, etc.), mirroring modules/auth/auth.schemas.ts.
export const adminLoginSchema = z
  .object({
    email: z.string().email().toLowerCase(),
    password: z.string().min(1).max(128),
    deviceId,
  })
  .strict();

export const adminRefreshSchema = z
  .object({
    refreshToken: z.string().min(1),
    deviceId,
  })
  .strict();

export const adminLogoutSchema = z
  .object({
    refreshToken: z.string().min(1).optional(),
    deviceId: deviceId.optional(),
    allDevices: z.boolean().optional(),
  })
  .strict();

/** POST /backoffice/team/invite — owner only. The owner picks the password. */
export const adminInviteSchema = z
  .object({
    email: z.string().email().toLowerCase(),
    password: z.string().min(8).max(128),
    displayName: z.string().min(1).max(80),
    permissions: z.array(permissionInput).min(1),
  })
  .strict();

/** PATCH /backoffice/team/:id/password — owner only, no current password needed. */
export const adminSetPasswordSchema = z
  .object({
    newPassword: z.string().min(8).max(128),
  })
  .strict();

/**
 * POST /backoffice/auth/change-password — any authenticated member, for their
 * OWN account. Requires the current password (unlike the owner's /team/:id/password
 * reset), so a stolen access token alone can't silently lock the real owner out.
 */
export const adminChangePasswordSchema = z
  .object({
    currentPassword: z.string().min(1).max(128),
    newPassword: z.string().min(8).max(128),
  })
  .strict();

export const adminUpdatePermissionsSchema = z
  .object({
    permissions: z.array(permissionInput).min(1),
  })
  .strict();

export type AdminLoginInput = z.infer<typeof adminLoginSchema>;
export type AdminRefreshInput = z.infer<typeof adminRefreshSchema>;
export type AdminLogoutInput = z.infer<typeof adminLogoutSchema>;
export type AdminInviteInput = z.infer<typeof adminInviteSchema>;
export type AdminSetPasswordInput = z.infer<typeof adminSetPasswordSchema>;
export type AdminChangePasswordInput = z.infer<typeof adminChangePasswordSchema>;
export type AdminUpdatePermissionsInput = z.infer<typeof adminUpdatePermissionsSchema>;

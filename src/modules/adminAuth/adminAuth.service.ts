import type { AdminUser, Prisma } from '@prisma/client';
import { AppError } from '../../core/errors.js';
import { hashPassword, verifyPassword } from '../../core/password.js';
import { generateRefreshToken, hashToken, adminRefreshExpiry } from '../../core/tokens.js';
import type { AdminAccessClaims } from '../../plugins/adminAuth.js';
import { adminAuthRepository } from './adminAuth.repository.js';
import type {
  AdminLoginInput,
  AdminRefreshInput,
  AdminInviteInput,
  AdminUpdatePermissionsInput,
} from './adminAuth.schemas.js';

/** Signs a short-lived back-office access token (delegated to @fastify/jwt's adminJwt namespace). */
export type AdminAccessSigner = (claims: AdminAccessClaims) => Promise<string>;

export interface AdminAuthTokens {
  accessToken: string;
  refreshToken: string; // plaintext, returned once; only hash is stored
  refreshExpiresAt: Date;
}

export interface AdminAuthResult {
  admin: AdminUser;
  tokens: AdminAuthTokens;
}

/** Issue an access + refresh pair and persist the refresh hash for a device. */
async function issueTokens(
  admin: AdminUser,
  deviceId: string,
  sign: AdminAccessSigner,
): Promise<AdminAuthTokens> {
  const accessToken = await sign({ sub: admin.id, isOwner: admin.isOwner });
  const refreshToken = generateRefreshToken();
  const expiresAt = adminRefreshExpiry();
  await adminAuthRepository.createRefreshToken({
    adminUserId: admin.id,
    tokenHash: hashToken(refreshToken),
    deviceId,
    expiresAt,
  });
  return { accessToken, refreshToken, refreshExpiresAt: expiresAt };
}

/** Strip the password hash before a member record ever leaves the service layer. */
function serializeAdmin(admin: AdminUser) {
  const { passwordHash: _passwordHash, ...safe } = admin;
  return safe;
}

export const adminAuthService = {
  async login(
    input: AdminLoginInput,
    sign: AdminAccessSigner,
    ipAddress: string | null,
  ): Promise<AdminAuthResult> {
    const admin = await adminAuthRepository.findByEmail(input.email);
    // Same error whether the email or password is wrong (no account enumeration).
    if (!admin) throw new AppError('INVALID_CREDENTIALS', 'Invalid email or password');
    const ok = await verifyPassword(admin.passwordHash, input.password);
    if (!ok) throw new AppError('INVALID_CREDENTIALS', 'Invalid email or password');
    if (admin.disabledAt) throw new AppError('ADMIN_ACCOUNT_DISABLED', 'This account has been disabled');

    const tokens = await issueTokens(admin, input.deviceId, sign);
    await adminAuthRepository.logActivity({
      adminUserId: admin.id,
      action: 'login',
      ipAddress,
    });
    return { admin, tokens };
  },

  /** Rotate a refresh token: mirrors modules/auth/auth.service.ts refresh(). */
  async refresh(input: AdminRefreshInput, sign: AdminAccessSigner): Promise<AdminAuthResult> {
    const record = await adminAuthRepository.findRefreshToken(hashToken(input.refreshToken));
    if (!record) throw new AppError('UNAUTHENTICATED', 'Unknown refresh token');
    if (record.deviceId !== input.deviceId) {
      throw new AppError('UNAUTHENTICATED', 'Refresh token does not match device');
    }
    if (record.revokedAt) throw new AppError('TOKEN_REVOKED', 'Session was revoked');
    if (record.expiresAt.getTime() <= Date.now()) {
      throw new AppError('TOKEN_EXPIRED', 'Session expired, please sign in again');
    }

    const admin = await adminAuthRepository.findById(record.adminUserId);
    if (!admin || admin.disabledAt) throw new AppError('UNAUTHENTICATED', 'Account no longer active');

    await adminAuthRepository.revokeRefreshToken(record.id, new Date());
    const tokens = await issueTokens(admin, input.deviceId, sign);
    return { admin, tokens };
  },

  async logout(
    adminUserId: string | null,
    opts: { refreshToken?: string; deviceId?: string; allDevices?: boolean },
  ): Promise<void> {
    const now = new Date();
    if (opts.refreshToken) {
      const record = await adminAuthRepository.findRefreshToken(hashToken(opts.refreshToken));
      if (record && !record.revokedAt) {
        await adminAuthRepository.revokeRefreshToken(record.id, now);
      }
    } else if (adminUserId) {
      if (opts.allDevices) {
        await adminAuthRepository.revokeAll(adminUserId, now);
      } else if (opts.deviceId) {
        await adminAuthRepository.revokeByDevice(adminUserId, opts.deviceId, now);
      }
    }
    if (adminUserId) {
      await adminAuthRepository.logActivity({ adminUserId, action: 'logout' });
    }
  },

  /**
   * Create a new back-office member. Owner-only (enforced by the route guard,
   * not here). There is no self-signup and no invitation-acceptance flow: the
   * owner picks the password up front and hands it to the member out of band
   * — the "invite link" the front shows is just a bookmark to the login page.
   */
  async invite(
    input: AdminInviteInput,
    invitedBy: string,
  ): Promise<AdminUser> {
    const existing = await adminAuthRepository.findByEmail(input.email);
    if (existing) throw new AppError('ADMIN_EMAIL_TAKEN', 'An account already uses this email');

    const admin = await adminAuthRepository.create({
      email: input.email,
      passwordHash: await hashPassword(input.password),
      displayName: input.displayName,
      isOwner: false,
    });
    await adminAuthRepository.replacePermissions(admin.id, input.permissions);
    await adminAuthRepository.logActivity({
      adminUserId: invitedBy,
      action: 'team.member_invited',
      metadata: { targetAdminId: admin.id, email: admin.email },
    });
    return admin;
  },

  /**
   * Owner resets any member's password (including their own). No current
   * password required — this is the "admin can reconfigure anyone's login"
   * capability. Every existing session for that member is revoked so a
   * stolen device is logged out the moment the password changes.
   */
  async setPassword(targetAdminId: string, newPassword: string, changedBy: string): Promise<void> {
    const target = await adminAuthRepository.findById(targetAdminId);
    if (!target) throw new AppError('NOT_FOUND', 'Member not found');

    await adminAuthRepository.updatePassword(targetAdminId, await hashPassword(newPassword));
    await adminAuthRepository.revokeAll(targetAdminId, new Date());
    await adminAuthRepository.logActivity({
      adminUserId: changedBy,
      action: 'team.password_reset',
      metadata: { targetAdminId, targetEmail: target.email },
    });
  },

  /**
   * A member changes their OWN password (including the owner, for themself).
   * Unlike setPassword (owner resetting someone else's), this requires the
   * current password — the self-service equivalent of auth.service.changePassword.
   */
  async changeOwnPassword(
    adminUserId: string,
    currentPassword: string,
    newPassword: string,
  ): Promise<void> {
    const admin = await adminAuthRepository.findById(adminUserId);
    if (!admin) throw new AppError('UNAUTHENTICATED', 'Account not found');

    const ok = await verifyPassword(admin.passwordHash, currentPassword);
    if (!ok) throw new AppError('INVALID_CREDENTIALS', 'Current password is incorrect');

    await adminAuthRepository.updatePassword(adminUserId, await hashPassword(newPassword));
    // Every other session is revoked; the caller keeps using their current
    // access token until it naturally expires (mirrors auth.service.changePassword).
    await adminAuthRepository.revokeAll(adminUserId, new Date());
    await adminAuthRepository.logActivity({ adminUserId, action: 'account.password_changed' });
  },

  async updatePermissions(
    targetAdminId: string,
    input: AdminUpdatePermissionsInput,
    changedBy: string,
  ): Promise<void> {
    const target = await adminAuthRepository.findById(targetAdminId);
    if (!target) throw new AppError('NOT_FOUND', 'Member not found');
    if (target.isOwner) throw new AppError('FORBIDDEN', "The owner's access cannot be restricted");

    await adminAuthRepository.replacePermissions(targetAdminId, input.permissions);
    await adminAuthRepository.logActivity({
      adminUserId: changedBy,
      action: 'team.permissions_updated',
      metadata: { targetAdminId },
    });
  },

  async listTeam() {
    const members = await adminAuthRepository.listActive();
    return members.map(serializeAdmin);
  },

  listActivity(adminUserId?: string) {
    return adminAuthRepository.listActivity({ adminUserId });
  },

  /** Record a mutating back-office action for the activity log (called from other modules). */
  logAction(adminUserId: string, action: string, metadata?: Prisma.InputJsonValue, ipAddress?: string | null) {
    return adminAuthRepository.logActivity({ adminUserId, action, metadata, ipAddress });
  },
};

import type { User } from '@prisma/client';
import { AppError } from '../../core/errors.js';
import { hashPassword, verifyPassword } from '../../core/password.js';
import {
  generateRefreshToken,
  hashToken,
  refreshExpiry,
  initialsFrom,
} from '../../core/tokens.js';
import type { AccessClaims } from '../../plugins/auth.js';
import { authRepository } from './auth.repository.js';
import type { RegisterInput, LoginInput, RefreshInput } from './auth.schemas.js';

/** Signs a short-lived access token (delegated to @fastify/jwt). */
export type AccessSigner = (claims: AccessClaims) => string;

export interface AuthTokens {
  accessToken: string;
  refreshToken: string; // plaintext, returned once; only hash is stored
  refreshExpiresAt: Date;
}

export interface AuthResult {
  user: User;
  tokens: AuthTokens;
}

/** Issue an access + refresh pair and persist the refresh hash for a device. */
async function issueTokens(
  user: User,
  deviceId: string,
  sign: AccessSigner,
): Promise<AuthTokens> {
  const accessToken = sign({ sub: user.id, role: user.role });
  const refreshToken = generateRefreshToken();
  const expiresAt = refreshExpiry();
  await authRepository.createRefreshToken({
    userId: user.id,
    tokenHash: hashToken(refreshToken),
    deviceId,
    expiresAt,
  });
  return { accessToken, refreshToken, refreshExpiresAt: expiresAt };
}

export const authService = {
  async register(input: RegisterInput, sign: AccessSigner): Promise<AuthResult> {
    const existing = await authRepository.findUserByEmail(input.email);
    if (existing) throw new AppError('EMAIL_TAKEN', 'Email already registered');

    const user = await authRepository.createUser({
      email: input.email,
      passwordHash: await hashPassword(input.password),
      displayName: input.displayName,
      avatarInitials: initialsFrom(input.displayName),
      timezone: input.timezone ?? 'UTC',
      language: input.language ?? 'en',
    });

    const tokens = await issueTokens(user, input.deviceId, sign);
    return { user, tokens };
  },

  async login(input: LoginInput, sign: AccessSigner): Promise<AuthResult> {
    const user = await authRepository.findUserByEmail(input.email);
    // Same error whether the email or password is wrong (no user enumeration).
    if (!user || !user.passwordHash) {
      throw new AppError('INVALID_CREDENTIALS', 'Invalid email or password');
    }
    const ok = await verifyPassword(user.passwordHash, input.password);
    if (!ok) throw new AppError('INVALID_CREDENTIALS', 'Invalid email or password');

    const tokens = await issueTokens(user, input.deviceId, sign);
    return { user, tokens };
  },

  /**
   * Rotate a refresh token: validate the presented token for the device,
   * revoke it, and issue a fresh pair (sliding 90-day window). A revoked or
   * expired token is rejected — enabling logout and "new install" semantics.
   */
  async refresh(input: RefreshInput, sign: AccessSigner): Promise<AuthResult> {
    const record = await authRepository.findRefreshToken(hashToken(input.refreshToken));
    if (!record) throw new AppError('UNAUTHENTICATED', 'Unknown refresh token');
    if (record.deviceId !== input.deviceId) {
      throw new AppError('UNAUTHENTICATED', 'Refresh token does not match device');
    }
    if (record.revokedAt) throw new AppError('TOKEN_REVOKED', 'Session was revoked');
    if (record.expiresAt.getTime() <= Date.now()) {
      throw new AppError('TOKEN_EXPIRED', 'Session expired, please sign in again');
    }

    const user = await authRepository.findUserById(record.userId);
    if (!user) throw new AppError('UNAUTHENTICATED', 'User no longer exists');

    // Rotation: invalidate the old token, mint a new pair.
    await authRepository.revokeRefreshToken(record.id, new Date());
    const tokens = await issueTokens(user, input.deviceId, sign);
    return { user, tokens };
  },

  /** Revoke the session(s): a single device, a specific token, or all. */
  async logout(
    userId: string | null,
    opts: { refreshToken?: string; deviceId?: string; allDevices?: boolean },
  ): Promise<void> {
    const now = new Date();
    if (opts.refreshToken) {
      const record = await authRepository.findRefreshToken(hashToken(opts.refreshToken));
      if (record && !record.revokedAt) {
        await authRepository.revokeRefreshToken(record.id, now);
      }
      return;
    }
    if (!userId) return;
    if (opts.allDevices) {
      await authRepository.revokeAll(userId, now);
    } else if (opts.deviceId) {
      await authRepository.revokeByDevice(userId, opts.deviceId, now);
    }
  },

  listSessions(userId: string) {
    return authRepository.listActiveSessions(userId);
  },
};

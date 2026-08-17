import crypto from 'node:crypto';
import type { User } from '@prisma/client';
import { AppError } from '../../core/errors.js';
import { hashPassword, verifyPassword } from '../../core/password.js';
import {
  generateRefreshToken,
  hashToken,
  refreshExpiry,
  initialsFrom,
  generateVerificationCode,
} from '../../core/tokens.js';
import { env } from '../../config/env.js';
import { sendMail, passwordResetEmail, emailVerificationEmail } from '../../core/mailer.js';
import { isEmailVerificationEnabled } from '../adminConfig/adminConfig.service.js';
import type { AccessClaims } from '../../plugins/auth.js';
import { authRepository } from './auth.repository.js';
import type {
  RegisterInput,
  LoginInput,
  RefreshInput,
  ChangePasswordInput,
  ResetRequestInput,
  ResetConfirmInput,
  VerifyEmailInput,
  ResendVerificationInput,
} from './auth.schemas.js';

/** Signs a short-lived access token (delegated to @fastify/jwt). */
export type AccessSigner = (claims: AccessClaims) => string;

export interface AuthTokens {
  accessToken: string;
  refreshToken: string; // plaintext, returned once; only hash is stored
  refreshExpiresAt: Date;
}

export interface AuthResult {
  user: User;
  /**
   * Absent quand EMAIL_VERIFICATION_ENABLED=true et que l'email n'est pas encore
   * vérifié. Les tokens sont émis après POST /auth/verify-email (ev:true).
   */
  tokens?: AuthTokens;
  /** Present on register when EMAIL_VERIFICATION_ENABLED — false if Resend failed (account still created). */
  verificationEmailSent?: boolean;
}

export interface VerifyEmailResult {
  user: User;
  tokens?: AuthTokens;
}

/** Build access-token claims for a user (includes ev when verification is on). */
function accessClaimsFor(user: User, emailVerificationEnabled: boolean): AccessClaims {
  return {
    sub: user.id,
    role: user.role,
    ...(emailVerificationEnabled ? { ev: user.emailVerified } : {}),
  };
}

/** Issue an access + refresh pair and persist the refresh hash for a device. */
async function issueTokens(
  user: User,
  deviceId: string,
  sign: AccessSigner,
  emailVerificationEnabled: boolean,
): Promise<AuthTokens> {
  const accessToken = sign(accessClaimsFor(user, emailVerificationEnabled));
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

/**
 * Génère un nouveau code (invalide les précédents), le persiste (hash only)
 * et l'envoie par email. Appelé par register() et resendVerificationCode() —
 * jamais invoqué si EMAIL_VERIFICATION_ENABLED est false (voir call sites).
 */
async function sendVerificationCode(userId: string, email: string): Promise<void> {
  const now = new Date();
  await authRepository.invalidateUserVerificationCodes(userId, now);

  const code = generateVerificationCode();
  const expiresAt = new Date(now.getTime() + env.EMAIL_VERIFICATION_CODE_TTL_MINUTES * 60 * 1000);
  await authRepository.createVerificationCode({
    userId,
    codeHash: hashToken(code),
    expiresAt,
  });

  await sendMail(emailVerificationEmail(email, code, env.EMAIL_VERIFICATION_CODE_TTL_MINUTES));
}

export const authService = {
  async register(input: RegisterInput, sign: AccessSigner): Promise<AuthResult> {
    const existing = await authRepository.findUserByEmail(input.email);
    if (existing) throw new AppError('EMAIL_TAKEN', 'Email already registered');

    // État lu UNE fois, au moment de l'inscription, et figé sur le compte —
    // un changement du switch back-office après coup n'affecte jamais un
    // compte déjà créé (ni pour le bloquer, ni pour le débloquer).
    const emailVerificationEnabled = await isEmailVerificationEnabled();

    const user = await authRepository.createUser({
      email: input.email,
      passwordHash: await hashPassword(input.password),
      displayName: input.displayName,
      username: input.username ?? null,
      avatarInitials: initialsFrom(input.displayName),
      timezone: input.timezone ?? 'UTC',
      language: input.language ?? 'en',
      // Flag OFF (défaut) : compte considéré vérifié dès la création, comme
      // avant l'introduction de cette fonctionnalité.
      emailVerified: !emailVerificationEnabled,
    });

    let verificationEmailSent: boolean | undefined;
    if (emailVerificationEnabled) {
      // Best-effort : un email qui échoue à partir (provider down / MAIL_FROM
      // sandbox Resend) ne doit jamais empêcher la création du compte — le
      // front lit `verificationEmailSent` et peut proposer /auth/verify-email/resend.
      try {
        await sendVerificationCode(user.id, user.email);
        verificationEmailSent = true;
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error('[auth] verification email failed after register:', err);
        verificationEmailSent = false;
      }
    }

    if (emailVerificationEnabled) {
      // Pas de session tant que l'email n'est pas vérifié : aucun token émis
      // ici. Les tokens arrivent uniquement depuis POST /auth/verify-email une
      // fois le code confirmé. Cela élimine tout vecteur d'accès à l'app avant
      // la vérification (plus sûr que les tokens ev:false).
      return { user, verificationEmailSent };
    }

    const tokens = await issueTokens(user, input.deviceId, sign, emailVerificationEnabled);
    return { user, tokens, verificationEmailSent };
  },

  /**
   * POST /auth/verify-email — always returns fresh tokens with ev:true when
   * possible. Expired / missing code → TOKEN_EXPIRED (front must call resend).
   * deviceId optional: falls back to the latest active session from register.
   */
  async verifyEmail(input: VerifyEmailInput, sign: AccessSigner): Promise<VerifyEmailResult> {
    const user = await authRepository.findUserByEmail(input.email);
    if (!user) throw new AppError('NOT_FOUND', 'Account not found');

    if (!user.emailVerified) {
      const record = await authRepository.findActiveVerificationCode(user.id);
      if (!record || record.expiresAt.getTime() <= Date.now()) {
        throw new AppError('TOKEN_EXPIRED', 'Code expired, request a new one');
      }
      if (record.attempts >= env.EMAIL_VERIFICATION_MAX_ATTEMPTS) {
        throw new AppError('TOO_MANY_ATTEMPTS', 'Too many attempts, request a new code');
      }

      const providedHash = hashToken(input.code);
      const a = Buffer.from(providedHash);
      const b = Buffer.from(record.codeHash);
      const match = a.length === b.length && crypto.timingSafeEqual(a, b);

      if (!match) {
        await authRepository.incrementVerificationAttempts(record.id);
        throw new AppError('INVALID_CODE', 'Incorrect code');
      }

      await authRepository.markVerificationCodeUsed(record.id, new Date());
      await authRepository.markEmailVerified(user.id);
      user.emailVerified = true;
    }

    const deviceId =
      input.deviceId ??
      (await authRepository.listActiveSessions(user.id))[0]?.deviceId;

    if (!deviceId) {
      return { user };
    }

    // Ce compte est passé par la vérification (on est dans ce handler) : le
    // token doit porter ev:true, peu importe l'état courant du switch.
    const tokens = await issueTokens(user, deviceId, sign, true);
    return { user, tokens };
  },

  /** POST /auth/verify-email/resend — feature-flagged. Silent no-op if unknown/already verified (no enumeration). */
  async resendVerificationCode(input: ResendVerificationInput): Promise<void> {
    const user = await authRepository.findUserByEmail(input.email);
    if (!user || user.emailVerified) return;
    try {
      await sendVerificationCode(user.id, user.email);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[auth] verification email resend failed:', err);
      throw new AppError('SERVICE_UNAVAILABLE', 'Unable to send verification email');
    }
  },

  async login(input: LoginInput, sign: AccessSigner): Promise<AuthResult> {
    const user = await authRepository.findUserByEmail(input.email);
    // Same error whether the email or password is wrong (no user enumeration).
    if (!user || !user.passwordHash) {
      throw new AppError('INVALID_CREDENTIALS', 'Invalid email or password');
    }
    const ok = await verifyPassword(user.passwordHash, input.password);
    if (!ok) throw new AppError('INVALID_CREDENTIALS', 'Invalid email or password');
    if (user.bannedAt) throw new AppError('ACCOUNT_BANNED', 'This account has been suspended');

    // emailVerified est figé à l'inscription (voir register()) : un compte
    // resté non vérifié reste bloqué même si le switch back-office est
    // désactivé depuis. Les comptes créés flag OFF ont emailVerified=true.
    if (!user.emailVerified) {
      throw new AppError('EMAIL_NOT_VERIFIED', 'Confirm your email before continuing');
    }

    const tokens = await issueTokens(user, input.deviceId, sign, true);
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
    if (user.bannedAt) {
      // A ban must kill existing sessions too, not just block new logins.
      await authRepository.revokeAll(user.id, new Date());
      throw new AppError('ACCOUNT_BANNED', 'This account has been suspended');
    }
    if (!user.emailVerified) {
      throw new AppError('EMAIL_NOT_VERIFIED', 'Confirm your email before continuing');
    }

    // Rotation: invalidate the old token, mint a new pair.
    await authRepository.revokeRefreshToken(record.id, new Date());
    const tokens = await issueTokens(user, input.deviceId, sign, true);
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

  /**
   * Change password for an authenticated user. Requires the current password
   * (defence against a stolen access token silently locking the owner out),
   * then revokes all other sessions so a compromised device is logged out.
   */
  async changePassword(userId: string, input: ChangePasswordInput): Promise<void> {
    const user = await authRepository.findUserById(userId);
    if (!user || !user.passwordHash) {
      throw new AppError('UNAUTHENTICATED', 'User not found');
    }
    const ok = await verifyPassword(user.passwordHash, input.currentPassword);
    if (!ok) throw new AppError('INVALID_CREDENTIALS', 'Current password is incorrect');

    await authRepository.updatePassword(userId, await hashPassword(input.newPassword));
    // Invalidate every session: the user re-authenticates everywhere.
    await authRepository.revokeAll(userId, new Date());
  },

  /**
   * Start a password reset. ALWAYS resolves the same way (no user enumeration):
   * if the email exists we generate a single-use token, email the link, and
   * invalidate any previous outstanding token. If not, we do nothing.
   */
  async requestPasswordReset(input: ResetRequestInput): Promise<void> {
    const user = await authRepository.findUserByEmail(input.email);
    if (!user) return; // silent — don't reveal whether the email exists

    const now = new Date();
    await authRepository.invalidateUserResets(user.id, now);

    const token = generateRefreshToken(); // opaque, high-entropy
    const expiresAt = new Date(now.getTime() + env.PASSWORD_RESET_TTL_MINUTES * 60 * 1000);
    await authRepository.createPasswordReset({
      userId: user.id,
      tokenHash: hashToken(token),
      expiresAt,
    });

    const sep = env.APP_RESET_URL.includes('?') ? '&' : '?';
    const resetUrl = `${env.APP_RESET_URL}${sep}token=${token}`;
    await sendMail(passwordResetEmail(user.email, resetUrl));
  },

  /** Confirm a reset: validate the token, set the new password, burn the token. */
  async confirmPasswordReset(input: ResetConfirmInput): Promise<void> {
    const record = await authRepository.findPasswordReset(hashToken(input.token));
    if (!record || record.usedAt || record.expiresAt.getTime() <= Date.now()) {
      throw new AppError('TOKEN_EXPIRED', 'Invalid or expired reset link');
    }

    const now = new Date();
    await authRepository.updatePassword(record.userId, await hashPassword(input.newPassword));
    await authRepository.markPasswordResetUsed(record.id, now);
    // Log out everywhere — a reset implies the old credentials are compromised.
    await authRepository.revokeAll(record.userId, now);
  },
};

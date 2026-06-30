import type { Prisma, User } from '@prisma/client';
import { prisma } from '../../config/prisma.js';

/** Data access for users and refresh tokens. No business logic here. */
export const authRepository = {
  findUserByEmail(email: string): Promise<User | null> {
    return prisma.user.findUnique({ where: { email } });
  },

  findUserById(id: string): Promise<User | null> {
    return prisma.user.findUnique({ where: { id } });
  },

  findUserByGoogleId(googleId: string): Promise<User | null> {
    return prisma.user.findUnique({ where: { googleId } });
  },

  /** Link a Google identity to an existing (email/password) account. */
  linkGoogleId(userId: string, googleId: string): Promise<User> {
    return prisma.user.update({ where: { id: userId }, data: { googleId } });
  },

  createUser(data: Prisma.UserCreateInput): Promise<User> {
    return prisma.user.create({ data });
  },

  createRefreshToken(data: {
    userId: string;
    tokenHash: string;
    deviceId: string;
    expiresAt: Date;
  }) {
    return prisma.refreshToken.create({ data });
  },

  findRefreshToken(tokenHash: string) {
    return prisma.refreshToken.findUnique({ where: { tokenHash } });
  },

  revokeRefreshToken(id: string, when: Date) {
    return prisma.refreshToken.update({
      where: { id },
      data: { revokedAt: when },
    });
  },

  revokeByDevice(userId: string, deviceId: string, when: Date) {
    return prisma.refreshToken.updateMany({
      where: { userId, deviceId, revokedAt: null },
      data: { revokedAt: when },
    });
  },

  revokeAll(userId: string, when: Date) {
    return prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: when },
    });
  },

  listActiveSessions(userId: string) {
    return prisma.refreshToken.findMany({
      where: { userId, revokedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: 'desc' },
      select: { id: true, deviceId: true, createdAt: true, expiresAt: true },
    });
  },

  updatePassword(userId: string, passwordHash: string) {
    return prisma.user.update({ where: { id: userId }, data: { passwordHash } });
  },

  // ── Password reset tokens ──────────────────────────────────────────────────

  createPasswordReset(data: { userId: string; tokenHash: string; expiresAt: Date }) {
    return prisma.passwordResetToken.create({ data });
  },

  findPasswordReset(tokenHash: string) {
    return prisma.passwordResetToken.findUnique({ where: { tokenHash } });
  },

  markPasswordResetUsed(id: string, when: Date) {
    return prisma.passwordResetToken.update({ where: { id }, data: { usedAt: when } });
  },

  /** Invalidate any outstanding reset tokens for a user (one active link at a time). */
  invalidateUserResets(userId: string, when: Date) {
    return prisma.passwordResetToken.updateMany({
      where: { userId, usedAt: null },
      data: { usedAt: when },
    });
  },
};

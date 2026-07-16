import type { AdminModule, AdminUser, Prisma } from '@prisma/client';
import { prisma } from '../../config/prisma.js';

/** Data access for back-office accounts, sessions, permissions and the activity log. No business logic here. */
export const adminAuthRepository = {
  findByEmail(email: string): Promise<AdminUser | null> {
    return prisma.adminUser.findUnique({ where: { email } });
  },

  findById(id: string): Promise<AdminUser | null> {
    return prisma.adminUser.findUnique({ where: { id } });
  },

  create(data: Prisma.AdminUserCreateInput): Promise<AdminUser> {
    return prisma.adminUser.create({ data });
  },

  updatePassword(id: string, passwordHash: string) {
    return prisma.adminUser.update({ where: { id }, data: { passwordHash } });
  },

  listActive() {
    return prisma.adminUser.findMany({
      where: { disabledAt: null },
      orderBy: { createdAt: 'asc' },
      include: { permissions: true },
    });
  },

  // ── Permissions ─────────────────────────────────────────────────────────

  /** Replace every permission row for a member in one transaction. */
  async replacePermissions(
    adminUserId: string,
    permissions: { module: AdminModule; canView: boolean; canEdit: boolean }[],
  ) {
    await prisma.$transaction([
      prisma.adminPermission.deleteMany({ where: { adminUserId } }),
      prisma.adminPermission.createMany({
        data: permissions.map((p) => ({ adminUserId, ...p })),
      }),
    ]);
  },

  // ── Refresh tokens (mirrors modules/auth/auth.repository.ts) ──────────────

  createRefreshToken(data: {
    adminUserId: string;
    tokenHash: string;
    deviceId: string;
    expiresAt: Date;
  }) {
    return prisma.adminRefreshToken.create({ data });
  },

  findRefreshToken(tokenHash: string) {
    return prisma.adminRefreshToken.findUnique({ where: { tokenHash } });
  },

  revokeRefreshToken(id: string, when: Date) {
    return prisma.adminRefreshToken.update({ where: { id }, data: { revokedAt: when } });
  },

  revokeByDevice(adminUserId: string, deviceId: string, when: Date) {
    return prisma.adminRefreshToken.updateMany({
      where: { adminUserId, deviceId, revokedAt: null },
      data: { revokedAt: when },
    });
  },

  revokeAll(adminUserId: string, when: Date) {
    return prisma.adminRefreshToken.updateMany({
      where: { adminUserId, revokedAt: null },
      data: { revokedAt: when },
    });
  },

  // ── Activity log ────────────────────────────────────────────────────────

  logActivity(data: {
    adminUserId: string;
    action: string;
    metadata?: Prisma.InputJsonValue;
    ipAddress?: string | null;
  }) {
    return prisma.adminActivityLog.create({ data });
  },

  listActivity(filter: { adminUserId?: string }, limit = 100) {
    return prisma.adminActivityLog.findMany({
      where: filter.adminUserId ? { adminUserId: filter.adminUserId } : undefined,
      orderBy: { createdAt: 'desc' },
      take: limit,
      include: { adminUser: { select: { displayName: true } } },
    });
  },
};

import { AppError } from '../../core/errors.js';
import { prisma } from '../../config/prisma.js';
import { adminAuthRepository } from '../adminAuth/adminAuth.repository.js';
import { adminUsersService } from '../adminUsers/adminUsers.service.js';
import type { ListReportsQuery, ResolveReportBody } from './adminModeration.schemas.js';

const userBrief = { id: true, email: true, displayName: true, username: true, bannedAt: true, friendsDisabledAt: true } as const;

/** Ce qui a été signalé, pour juger sans quitter la file : le message ou la réussite. */
async function loadTarget(kind: string, ref: string) {
  if (!ref) return null;
  if (kind === 'message') {
    return prisma.friendMessage.findUnique({
      where: { id: ref },
      select: { id: true, kind: true, payload: true, note: true, createdAt: true, senderId: true },
    });
  }
  if (kind === 'achievement') {
    return prisma.achievement.findUnique({
      where: { id: ref },
      select: { id: true, type: true, payload: true, createdAt: true },
    });
  }
  return null;
}

type Actor = { adminUserId: string; ipAddress?: string | null };

export const adminModerationService = {
  /** File des signalements, la plus ancienne d'abord pour les ouverts. */
  async list(query: ListReportsQuery) {
    const rows = await prisma.report.findMany({
      where: {
        ...(query.status ? { status: query.status } : {}),
        ...(query.targetUserId ? { targetUserId: query.targetUserId } : {}),
      },
      orderBy: { createdAt: query.status === 'open' ? 'asc' : 'desc' },
      take: query.limit + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
      include: { reporter: { select: userBrief }, targetUser: { select: userBrief } },
    });
    const page = rows.slice(0, query.limit);
    // Nombre de signalements par compte visé : aide à repérer les récidivistes.
    const targetIds = [...new Set(page.map((r) => r.targetUserId))];
    const counts = targetIds.length
      ? await prisma.report.groupBy({ by: ['targetUserId'], where: { targetUserId: { in: targetIds } }, _count: { _all: true } })
      : [];
    const countBy = new Map(counts.map((c) => [c.targetUserId, c._count._all]));
    const items = await Promise.all(
      page.map(async (r) => ({
        id: r.id,
        status: r.status,
        reason: r.reason,
        details: r.details,
        targetKind: r.targetKind,
        targetRef: r.targetRef,
        createdAt: r.createdAt,
        reporter: r.reporter,
        targetUser: r.targetUser,
        reportsAgainstTarget: countBy.get(r.targetUserId) ?? 0,
        target: await loadTarget(r.targetKind, r.targetRef),
      })),
    );
    return { items, nextCursor: rows.length > query.limit ? page[page.length - 1]!.id : null };
  },

  async summary() {
    const [open, last24h] = await Promise.all([
      prisma.report.count({ where: { status: 'open' } }),
      prisma.report.count({ where: { createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) } } }),
    ]);
    return { open, last24h };
  },

  async resolve(reportId: string, body: ResolveReportBody, actor: Actor) {
    const report = await prisma.report.findUnique({ where: { id: reportId } });
    if (!report) throw new AppError('NOT_FOUND', 'Report not found');
    const now = new Date();

    if (body.action === 'dismiss') {
      await prisma.report.update({ where: { id: reportId }, data: { status: 'reviewed' } });
    } else {
      if (body.action === 'disable_friends') {
        await prisma.user.update({ where: { id: report.targetUserId }, data: { friendsDisabledAt: now } });
      } else {
        await adminUsersService.ban(report.targetUserId, body.note ?? `report:${reportId}`);
      }
      // Tous les signalements encore ouverts sur ce compte sont traités d'un coup.
      await prisma.report.updateMany({
        where: { targetUserId: report.targetUserId, status: 'open' },
        data: { status: 'actioned' },
      });
      await prisma.report.update({ where: { id: reportId }, data: { status: 'actioned' } });
    }

    await adminAuthRepository.logActivity({
      adminUserId: actor.adminUserId,
      action: `moderation.${body.action}`,
      metadata: { reportId, targetUserId: report.targetUserId, note: body.note ?? null },
      ipAddress: actor.ipAddress ?? null,
    });
    return prisma.report.findUnique({ where: { id: reportId } });
  },

  /** Couper / rétablir l'accès aux fonctions entre amis, hors signalement. */
  async setFriendsAccess(userId: string, enabled: boolean, actor: Actor) {
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true } });
    if (!user) throw new AppError('NOT_FOUND', 'User not found');
    const updated = await prisma.user.update({
      where: { id: userId },
      data: { friendsDisabledAt: enabled ? null : new Date() },
      select: userBrief,
    });
    await adminAuthRepository.logActivity({
      adminUserId: actor.adminUserId,
      action: enabled ? 'moderation.enable_friends' : 'moderation.disable_friends',
      metadata: { targetUserId: userId },
      ipAddress: actor.ipAddress ?? null,
    });
    return updated;
  },
};

import { prisma } from '../../config/prisma.js';
import { AppError } from '../../core/errors.js';
import { getLearnedSourates } from '../me/learnedSourates.js';
import { friendsRepository } from './friends.repository.js';

/** Paliers de série publiés dans le fil d'activité. */
const STREAK_MILESTONES = [3, 7, 14, 30, 60, 100, 180, 365];

export interface ActivityView {
  id: string;
  user: { id: string; displayName: string; username: string | null; avatarInitials: string };
  type: 'sourate_mastered' | 'streak_milestone' | 'level_up';
  data: unknown;
  createdAt: string;
  cheers: number;
  cheeredByMe: boolean;
}

/**
 * Fil d'activité des amis (phase 2) : réussites publiées (sourate maîtrisée,
 * palier de série, passage de niveau) + réactions « bravo ». Les producteurs
 * appellent `record*` de façon best-effort (jamais bloquant pour l'action
 * principale — voir lesson.service.ts).
 */
export const friendsActivityService = {
  /** Publie « sourate maîtrisée » si elle est bien complète et pas déjà publiée. */
  async recordSourateIfMastered(userId: string, numero: number): Promise<{ numero: number; nom: string } | null> {
    try {
      const learned = await getLearnedSourates(userId);
      const s = learned.find((x) => x.numero === numero);
      if (!s) return null;
      const existing = await friendsRepository.findSourateMasteredActivity(userId, numero);
      if (existing) return { numero: s.numero, nom: s.nom };
      await friendsRepository.createActivity(userId, 'sourate_mastered', { numero: s.numero, nom: s.nom });
      return { numero: s.numero, nom: s.nom };
    } catch {
      // best-effort : le fil d'activité ne doit jamais casser la leçon.
      return null;
    }
  },

  /** Publie un palier de série (3, 7, 14, 30…) une seule fois par palier. */
  async recordStreakMilestone(userId: string, streak: number): Promise<void> {
    try {
      if (!STREAK_MILESTONES.includes(streak)) return;
      const existing = await prisma.friendActivity.findFirst({
        where: { userId, type: 'streak_milestone', data: { path: ['streak'], equals: streak } },
      });
      if (existing) return;
      await friendsRepository.createActivity(userId, 'streak_milestone', { streak });
    } catch {
      // best-effort
    }
  },

  /** Fil d'activité : mes réussites + celles de mes amis non bloqués. */
  async listActivity(userId: string, limit = 30): Promise<ActivityView[]> {
    const friendIds = await friendsRepository.listFriendIds(userId);
    const ids = [userId, ...friendIds];

    const blocks = await prisma.friendBlock.findMany({
      where: { OR: [{ blockerId: userId }, { blockedId: userId }] },
      select: { blockerId: true, blockedId: true },
    });
    const blocked = new Set<string>();
    for (const b of blocks) {
      blocked.add(b.blockerId);
      blocked.add(b.blockedId);
    }

    const rows = await friendsRepository.listActivities(ids, limit);
    return rows
      .filter((r) => !blocked.has(r.userId))
      .map((r) => ({
        id: r.id,
        user: r.user,
        type: r.type,
        data: r.data,
        createdAt: r.createdAt.toISOString(),
        cheers: r.cheers.length,
        cheeredByMe: r.cheers.some((c) => c.userId === userId),
      }));
  },

  /** Ajoute/retire ma réaction « bravo » sur une réussite (toggle). */
  async toggleCheer(userId: string, activityId: string) {
    const activity = await friendsRepository.getActivityById(activityId);
    if (!activity) throw new AppError('NOT_FOUND', 'Activity not found');

    if (activity.userId !== userId) {
      const friendship = await friendsRepository.findBetween(userId, activity.userId);
      if (!friendship) throw new AppError('NOT_FOUND', 'Activity not found');
      if (await friendsRepository.findBlockBetween(userId, activity.userId)) {
        throw new AppError('NOT_FOUND', 'Activity not found');
      }
    }

    const already = activity.cheers.some((c) => c.userId === userId);
    if (already) await friendsRepository.deleteCheer(activityId, userId);
    else await friendsRepository.upsertCheer(activityId, userId);

    const cheers = await prisma.friendActivityCheer.count({ where: { activityId } });
    return { cheered: !already, cheers };
  },
};

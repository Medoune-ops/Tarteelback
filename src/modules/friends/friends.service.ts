import { Prisma } from '@prisma/client';
import { prisma } from '../../config/prisma.js';
import { AppError } from '../../core/errors.js';
import { isPremiumActive } from '../../core/premium.js';
import {
  generateFriendCode,
  maxFriends,
  normalizeFriendCode,
} from '../../core/friends.js';
import { getLearnedSourates } from '../me/learnedSourates.js';
import { userRepository } from '../me/user.repository.js';
import { notificationService } from '../notifications/notification.service.js';
import { friendsRepository, friendUserSelect } from './friends.repository.js';
import {
  serializeFriend,
  serializeFriendProgress,
  serializePublicUser,
  type FriendView,
} from './friends.serializer.js';

/** Envoi de push « best effort » : ne doit jamais faire échouer la requête. */
async function pushBestEffort(
  userId: string,
  payload: { title: string; body: string; data?: Record<string, unknown> },
): Promise<void> {
  try {
    await notificationService.sendToUser(userId, payload);
  } catch {
    // Push optionnel : on ignore silencieusement.
  }
}

export const friendsService = {
  // ── Code de partage ─────────────────────────────────────────────────────

  /** GET /me/friends/code — mon code (généré à la demande, stable). */
  async getMyCode(userId: string) {
    const existing = await friendsRepository.getCode(userId);
    if (existing) return { code: existing.code };

    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        const created = await friendsRepository.createCode(userId, generateFriendCode());
        return { code: created.code };
      } catch (e) {
        // P2002 = collision de code (ou course sur userId) → on retente.
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
          const again = await friendsRepository.getCode(userId);
          if (again) return { code: again.code };
          continue;
        }
        throw e;
      }
    }
    throw new AppError('INTERNAL', 'Could not generate a friend code');
  },

  /** POST /me/friends/code/regenerate — remplace mon code par un nouveau. */
  async regenerateMyCode(userId: string) {
    const existing = await friendsRepository.getCode(userId);
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        const code = generateFriendCode();
        const saved = existing
          ? await friendsRepository.updateCode(userId, code)
          : await friendsRepository.createCode(userId, code);
        return { code: saved.code };
      } catch (e) {
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
          continue;
        }
        throw e;
      }
    }
    throw new AppError('INTERNAL', 'Could not generate a friend code');
  },

  // ── Ajout par code / QR (amitié immédiate) ──────────────────────────────

  /**
   * POST /me/friends/add — ajoute un ami à partir d'un code (saisi ou scanné).
   * Amitié IMMÉDIATE dans les deux cas. Vérifie : code valide, pas soi-même,
   * pas déjà ami, aucun blocage dans les deux sens, et la LIMITE D'AMIS DES
   * DEUX CÔTÉS (9 gratuit / 20 premium).
   */
  async addByCode(userId: string, rawCode: string): Promise<FriendView> {
    const code = normalizeFriendCode(rawCode);
    const owner = await friendsRepository.findCodeOwner(code);
    if (!owner) throw new AppError('FRIEND_CODE_INVALID', 'Invalid friend code');
    const targetId = owner.userId;

    if (targetId === userId) {
      throw new AppError('VALIDATION_ERROR', 'You cannot add yourself');
    }

    const [me, target] = await Promise.all([
      userRepository.getOrThrow(userId),
      userRepository.getOrThrow(targetId),
    ]);

    if (await friendsRepository.findBetween(userId, targetId)) {
      throw new AppError('FRIEND_EXISTS', 'You are already friends');
    }
    if (await friendsRepository.findBlockBetween(userId, targetId)) {
      throw new AppError('FRIEND_BLOCKED', 'Unable to add this user');
    }

    const now = new Date();
    const meLimit = maxFriends(isPremiumActive(me, now));
    const targetLimit = maxFriends(isPremiumActive(target, now));
    const [meCount, targetCount] = await Promise.all([
      friendsRepository.countFriends(userId),
      friendsRepository.countFriends(targetId),
    ]);
    if (meCount >= meLimit || targetCount >= targetLimit) {
      throw new AppError('FRIEND_LIMIT_REACHED', 'Friend limit reached');
    }

    const created = await prisma.$transaction(async (tx) => {
      // Verrou des deux lignes User (ordre canonique pour éviter les deadlocks),
      // puis re-vérification anti-course.
      const [first, second] = [userId, targetId].sort();
      await tx.$queryRaw`SELECT id FROM "User" WHERE id IN (${first}, ${second}) ORDER BY id FOR UPDATE`;

      const already = await tx.friendship.findFirst({
        where: {
          OR: [
            { user1Id: userId, user2Id: targetId },
            { user1Id: targetId, user2Id: userId },
          ],
        },
      });
      if (already) throw new AppError('FRIEND_EXISTS', 'You are already friends');

      const { user1Id, user2Id } = userId < targetId
        ? { user1Id: userId, user2Id: targetId }
        : { user1Id: targetId, user2Id: userId };
      return tx.friendship.create({
        data: { user1Id, user2Id },
        include: {
          user1: { select: friendUserSelect },
          user2: { select: friendUserSelect },
        },
      });
    });

    await pushBestEffort(targetId, {
      title: 'Nouvel ami',
      body: `${me.displayName} vous a ajouté comme ami.`,
      data: { type: 'friend_added', userId },
    });

    return serializeFriend(created, userId);
  },

  // ── Liste & progrès ─────────────────────────────────────────────────────

  /** GET /me/friends — liste de mes amis. */
  async listFriends(userId: string): Promise<FriendView[]> {
    const rows = await friendsRepository.list(userId);
    return rows.map((r) => serializeFriend(r, userId));
  },

  /**
   * GET /me/friends/leaderboard — classement de la semaine (weeklyXp) entre
   * moi et mes amis. Départage par série.
   */
  async getLeaderboard(userId: string) {
    const friendIds = await friendsRepository.listFriendIds(userId);
    const users = await prisma.user.findMany({
      where: { id: { in: [userId, ...friendIds] } },
      select: { ...friendUserSelect, weeklyXp: true, streak: true },
    });
    const sorted = users.sort((a, b) => b.weeklyXp - a.weeklyXp || b.streak - a.streak);
    return {
      entries: sorted.map((u, i) => ({
        rank: i + 1,
        isMe: u.id === userId,
        user: serializePublicUser(u),
        weeklyXp: u.weeklyXp,
        streak: u.streak,
      })),
    };
  },

  /**
   * GET /me/friends/:userId/progress — progrès d'un ami : streak, XP de la
   * semaine et sourates maîtrisées (toutes les leçons de la sourate terminées).
   */
  async getFriendProgress(userId: string, friendId: string) {
    const friendship = await friendsRepository.findBetween(userId, friendId);
    if (!friendship) throw new AppError('NOT_FOUND', 'Friend not found');
    if (await friendsRepository.findBlockBetween(userId, friendId)) {
      throw new AppError('NOT_FOUND', 'Friend not found');
    }

    const target = await prisma.user.findUnique({
      where: { id: friendId },
      select: { ...friendUserSelect, streak: true, weeklyXp: true },
    });
    if (!target) throw new AppError('NOT_FOUND', 'Friend not found');

    const learned = await getLearnedSourates(friendId);
    return serializeFriendProgress(target, learned);
  },

  // ── Retrait / blocage / signalement ─────────────────────────────────────

  /** DELETE /me/friends/:id — retire une amitié (les deux côtés). */
  async removeFriend(userId: string, friendshipId: string) {
    const friendship = await friendsRepository.getById(friendshipId);
    if (!friendship || (friendship.user1Id !== userId && friendship.user2Id !== userId)) {
      throw new AppError('NOT_FOUND', 'Friendship not found');
    }
    await friendsRepository.deleteById(friendshipId);
    return { removed: true };
  },

  /**
   * POST /me/friends/:userId/block — bloque un utilisateur. Effets : supprime
   * l'amitié éventuelle et (phase 3) retire le bloqué des défis partagés.
   */
  async blockUser(userId: string, blockedId: string) {
    if (blockedId === userId) {
      throw new AppError('VALIDATION_ERROR', 'You cannot block yourself');
    }
    const target = await friendsRepository.getUserPublic(blockedId);
    if (!target) throw new AppError('NOT_FOUND', 'User not found');

    await prisma.$transaction(async (tx) => {
      await tx.friendBlock.upsert({
        where: { blockerId_blockedId: { blockerId: userId, blockedId } },
        create: { blockerId: userId, blockedId },
        update: {},
      });
      // Retire l'amitié éventuelle (le blocage prime).
      const { user1Id, user2Id } = userId < blockedId
        ? { user1Id: userId, user2Id: blockedId }
        : { user1Id: blockedId, user2Id: userId };
      await tx.friendship.deleteMany({ where: { user1Id, user2Id } });
      // Retire le bloqué des défis partagés avec le bloqueur (et réciproquement).
      await tx.challengeParticipant.deleteMany({
        where: { userId: blockedId, challenge: { creatorId: userId } },
      });
      await tx.challengeParticipant.deleteMany({
        where: { userId, challenge: { creatorId: blockedId } },
      });
    });

    return { blocked: true };
  },

  /** DELETE /me/friends/:userId/block — débloque un utilisateur. */
  async unblockUser(userId: string, blockedId: string) {
    await friendsRepository.deleteBlock(userId, blockedId);
    return { unblocked: true };
  },

  /** POST /me/friends/report — signale un utilisateur (motif libre court). */
  async reportUser(userId: string, reportedId: string, reason: string) {
    if (reportedId === userId) {
      throw new AppError('VALIDATION_ERROR', 'You cannot report yourself');
    }
    const target = await friendsRepository.getUserPublic(reportedId);
    if (!target) throw new AppError('NOT_FOUND', 'User not found');
    await friendsRepository.createReport(userId, reportedId, reason);
    return { reported: true };
  },
};

import { AppError } from '../../core/errors.js';
import crypto from 'node:crypto';
import { env } from '../../config/env.js';
import { isPremiumActive } from '../../core/premium.js';
import { orderPair, canAddFriend, canBecomeFriends, dayWindow } from '../../core/friendship.js';
import { requireFriendsEnabled } from './friends.guard.js';
import { friendsRepository } from './friends.repository.js';
import { userRepository } from '../me/user.repository.js';
import { getLearnedSourates } from '../me/learnedSourates.js';
import { leagueRepository } from '../leagues/league.repository.js';
import { serializePublicProfile } from '../../core/friends.js';
import { prisma } from '../../config/prisma.js';
import { enqueue, scheduleOutboxDrain } from '../../core/outbox.js';
import '../notifications/friendsPushHandler.js';

const MAX_FRIEND_REQUESTS_PER_DAY = 30;
const MAX_PENDING_REQUESTS = 50;
const CODE_SEARCH_PER_MINUTE = 20;
const CODE_SEARCH_PER_DAY = 100;

type RateBucket = { count: number; resetAt: number };
const codeSearchMinute = new Map<string, RateBucket>();
const codeSearchDay = new Map<string, RateBucket>();

function consumeRateLimit(buckets: Map<string, RateBucket>, key: string, limit: number, windowMs: number): boolean {
  const now = Date.now();
  const b = buckets.get(key);
  if (!b || now >= b.resetAt) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  if (b.count >= limit) return false;
  b.count += 1;
  return true;
}

async function toPublicProfile(user: {
  id: string;
  displayName: string;
  username: string | null;
  avatarInitials: string;
  streak: number;
  weeklyXp: number;
}) {
  const learned = await getLearnedSourates(user.id);
  const week = await leagueRepository.currentWeekForUser(user.id, new Date());
  return serializePublicProfile({
    id: user.id,
    displayName: user.displayName,
    username: user.username,
    avatarInitials: user.avatarInitials,
    streak: user.streak,
    learnedSouratesCount: learned.length,
    leagueTier: week?.league?.nom ?? '',
    weeklyXp: user.weeklyXp,
  });
}

export const friendsService = {
  async ensureFriendsEnabled(userId?: string | null) {
    requireFriendsEnabled(userId);
  },

  async sendRequest(meId: string, code: string) {
    requireFriendsEnabled(meId);
    const me = await userRepository.getOrThrow(meId);

    // quotas "recherche de code" (par minute et par jour)
    if (!consumeRateLimit(codeSearchMinute, meId, CODE_SEARCH_PER_MINUTE, 60_000)) {
      throw new AppError('QUOTA_EXCEEDED', 'Too many code searches per minute');
    }
    if (!consumeRateLimit(codeSearchDay, meId, CODE_SEARCH_PER_DAY, 24 * 60 * 60 * 1000)) {
      throw new AppError('QUOTA_EXCEEDED', 'Too many code searches per day');
    }

    const target = await friendsRepository.findUserByReferralCode(code);
    // Anti-énumération : code inexistant / non découvrable / bloqué / banni = même réponse.
    const invalid =
      !target ||
      !!target.bannedAt ||
      !target.friendsDiscoverable ||
      (await friendsRepository.isBlockedEither(meId, target.id));
    if (target?.id === meId) {
      throw new AppError('CANNOT_ADD_SELF', 'Cannot add yourself');
    }
    if (invalid) {
      throw new AppError('INVITE_INVALID', 'Invalid invite code');
    }

    // Limites des deux personnes.
    const targetUser = await userRepository.getOrThrow(target.id);
    const [meFriends, targetFriends] = await Promise.all([
      friendsRepository.countAcceptedFriends(meId),
      friendsRepository.countAcceptedFriends(target.id),
    ]);
    const mePremium = isPremiumActive(me, new Date());
    const targetPremium = isPremiumActive(targetUser, new Date());
    if (!canBecomeFriends(meFriends, mePremium, targetFriends, targetPremium)) {
      throw new AppError('FRIEND_LIMIT', 'Friend limit reached');
    }

    // Quotas quotidiens / en attente pour l'expéditeur
    const { start } = dayWindow(me, new Date());
    const recent = await friendsRepository.countRecentRequests(meId, start);
    if (recent >= MAX_FRIEND_REQUESTS_PER_DAY) {
      throw new AppError('QUOTA_EXCEEDED', 'Daily friend request quota exceeded');
    }
    const pendingSent = await friendsRepository.countPendingSent(meId);
    if (pendingSent >= MAX_PENDING_REQUESTS) {
      throw new AppError('QUOTA_EXCEEDED', 'Too many pending requests');
    }

    const { low, high } = orderPair(meId, target.id);
    const pair = await friendsRepository.findPair(low, high);
    if (pair?.status === 'accepted') {
      throw new AppError('ALREADY_FRIENDS', 'Already friends');
    }
    if (pair?.status === 'pending' && pair.requestedById === meId) {
      throw new AppError('FRIEND_REQUEST_PENDING', 'Friend request already pending');
    }

    // Acceptation directe si l'autre avait déjà envoyé une demande.
    if (pair?.status === 'pending' && pair.requestedById === target.id) {
      const updated = await prisma.$transaction(async (tx) => {
        const fresh = await tx.friendship.findUnique({ where: { id: pair.id } });
        if (!fresh || fresh.status !== 'pending') {
          // concurrence : re-vérifier
          if (fresh?.status === 'accepted') throw new AppError('ALREADY_FRIENDS', 'Already friends');
        }
        const updatedPair = await tx.friendship.update({
          where: { id: pair.id },
          data: { status: 'accepted', acceptedAt: new Date() },
        });
        await enqueue(tx, { type: 'friend.request.accepted', userId: pair.requestedById, payload: { friendshipId: updatedPair.id, accepterId: meId } });
        return updatedPair;
      });
      scheduleOutboxDrain();
      return { accepted: true, friendshipId: updated.id };
    }

    // Création pending (transaction + contrainte unique).
    try {
      const created = await prisma.$transaction(async (tx) => {
        const row = await tx.friendship.create({
          data: {
            userLowId: low,
            userHighId: high,
            requestedById: meId,
            status: 'pending',
            source: 'code',
          },
        });
        await enqueue(tx, { type: 'friend.request.created', userId: target.id, payload: { friendshipId: row.id, requesterId: meId } });
        return row;
      });
      scheduleOutboxDrain();
      return { accepted: false, friendshipId: created.id };
    } catch (e) {
      // P2002 = course concurrente ; relire et adapter.
      if (e && typeof e === 'object' && (e as { code?: string }).code === 'P2002') {
        const again = await friendsRepository.findPair(low, high);
        if (again?.status === 'accepted') throw new AppError('ALREADY_FRIENDS', 'Already friends');
        if (again?.status === 'pending' && again.requestedById === target.id) {
          const updated = await prisma.friendship.update({
            where: { id: again.id },
            data: { status: 'accepted', acceptedAt: new Date() },
          });
          return { accepted: true, friendshipId: updated.id };
        }
        if (again?.status === 'pending' && again.requestedById === meId) {
          throw new AppError('FRIEND_REQUEST_PENDING', 'Friend request already pending');
        }
      }
      throw e;
    }
  },

  async listRequests(meId: string) {
    requireFriendsEnabled(meId);
    const [receivedRows, sentRows] = await Promise.all([
      friendsRepository.listPendingReceived(meId),
      friendsRepository.listPendingSent(meId),
    ]);

    const received = await Promise.all(
      receivedRows.map(async (f) => {
        const otherId = f.requestedById === meId ? (f.userLowId === meId ? f.userHighId : f.userLowId) : f.requestedById;
        const u = await userRepository.getOrThrow(otherId);
        return { id: f.id, user: await toPublicProfile(u), createdAt: f.createdAt };
      }),
    );
    const sent = await Promise.all(
      sentRows.map(async (f) => {
        const otherId = f.userLowId === meId ? f.userHighId : f.userLowId;
        const u = await userRepository.getOrThrow(otherId);
        return { id: f.id, user: await toPublicProfile(u), createdAt: f.createdAt };
      }),
    );
    return { received, sent };
  },

  async accept(meId: string, requestId: string) {
    requireFriendsEnabled(meId);
    const fri = await prisma.friendship.findUnique({ where: { id: requestId } });
    if (!fri || fri.status !== 'pending') {
      throw new AppError('NOT_FOUND', 'Request not found');
    }
    if (fri.requestedById === meId) {
      throw new AppError('FORBIDDEN', 'Not the recipient');
    }
    if (fri.userLowId !== meId && fri.userHighId !== meId) {
      throw new AppError('FORBIDDEN', 'Not the recipient');
    }

    const otherId = fri.userLowId === meId ? fri.userHighId : fri.userLowId;
    const [me, other] = await Promise.all([
      userRepository.getOrThrow(meId),
      userRepository.getOrThrow(otherId),
    ]);
    const [meFriends, otherFriends] = await Promise.all([
      friendsRepository.countAcceptedFriends(meId),
      friendsRepository.countAcceptedFriends(otherId),
    ]);
    if (!canBecomeFriends(meFriends, isPremiumActive(me, new Date()), otherFriends, isPremiumActive(other, new Date()))) {
      throw new AppError('FRIEND_LIMIT', 'Friend limit reached');
    }

    const updated = await prisma.$transaction(async (tx) => {
      const row = await tx.friendship.update({
        where: { id: requestId },
        data: { status: 'accepted', acceptedAt: new Date() },
      });
      if (fri.requestedById !== meId) {
        await enqueue(tx, { type: 'friend.request.accepted', userId: fri.requestedById, payload: { friendshipId: row.id, accepterId: meId } });
      }
      return row;
    });
    scheduleOutboxDrain();
    return { accepted: true, friendshipId: updated.id };
  },

  async decline(meId: string, requestId: string) {
    requireFriendsEnabled(meId);
    const fri = await prisma.friendship.findUnique({ where: { id: requestId } });
    if (!fri || fri.status !== 'pending') throw new AppError('NOT_FOUND', 'Request not found');
    if (fri.requestedById === meId) throw new AppError('FORBIDDEN', 'Not the recipient');
    if (fri.userLowId !== meId && fri.userHighId !== meId) throw new AppError('FORBIDDEN', 'Not the recipient');
    await prisma.friendship.delete({ where: { id: requestId } });
    return { declined: true };
  },

  async cancel(meId: string, requestId: string) {
    requireFriendsEnabled(meId);
    const fri = await prisma.friendship.findUnique({ where: { id: requestId } });
    if (!fri || fri.status !== 'pending') throw new AppError('NOT_FOUND', 'Request not found');
    if (fri.requestedById !== meId) throw new AppError('FORBIDDEN', 'Not the sender');
    await prisma.friendship.delete({ where: { id: requestId } });
    return { cancelled: true };
  },

  async removeFriend(meId: string, otherId: string) {
    requireFriendsEnabled(meId);
    if (meId === otherId) throw new AppError('CANNOT_ADD_SELF', 'Cannot remove yourself');
    const { low, high } = orderPair(meId, otherId);
    const fri = await prisma.friendship.findUnique({
      where: { userLowId_userHighId: { userLowId: low, userHighId: high } },
    });
    if (!fri || fri.status !== 'accepted') throw new AppError('NOT_FRIENDS', 'Not friends');
    await prisma.friendship.delete({ where: { id: fri.id } });
    return { removed: true };
  },

  async listFriends(meId: string, cursor?: string | null, limit = 20) {
    requireFriendsEnabled(meId);
    const safeLimit = Math.min(Math.max(1, limit), 50);
    const rows = await friendsRepository.listAccepted(meId, cursor, safeLimit);
    const hasMore = rows.length > safeLimit;
    const pageRows = hasMore ? rows.slice(0, safeLimit) : rows;
    const items = await Promise.all(
      pageRows.map(async (f) => {
        const otherId = f.userLowId === meId ? f.userHighId : f.userLowId;
        const user = await userRepository.getOrThrow(otherId);
        const publicProfile = await toPublicProfile(user);
        return {
          user: publicProfile,
          friendsSince: (f.acceptedAt ?? f.createdAt).toISOString(),
        };
      }),
    );
    const last = pageRows[pageRows.length - 1];
    const nextCursor = hasMore && last ? last.id : null;
    return { items, nextCursor };
  },

  hashToken(raw: string): string {
    return crypto.createHash('sha256').update(raw).digest('hex');
  },

  async createQrInvite(meId: string) {
    requireFriendsEnabled(meId);
    const me = await userRepository.getOrThrow(meId);
    if (me.bannedAt) throw new AppError('INVITE_INVALID', 'Invalid invite');
    const raw = crypto.randomBytes(16).toString('base64url'); // 128 bits
    const tokenHash = crypto.createHash('sha256').update(raw).digest('hex');
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 10 * 60 * 1000);
    const invite = await friendsRepository.createInvite({
      tokenHash,
      userId: meId,
      kind: 'qr',
      expiresAt,
      maxUses: 5,
    });
    const base = env.PUBLIC_WEB_URL || '';
    return { url: `${base}/f/${raw}`, expiresAt: invite.expiresAt };
  },

  async createLinkInvite(meId: string) {
    requireFriendsEnabled(meId);
    const me = await userRepository.getOrThrow(meId);
    if (!me.friendsDiscoverable) {
      throw new AppError('FORBIDDEN', 'Friends discoverability disabled');
    }
    if (me.bannedAt) throw new AppError('INVITE_INVALID', 'Invalid invite');

    const rawToken = crypto.randomBytes(16).toString('base64url');
    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    const invite = await friendsRepository.createInvite({
      tokenHash,
      userId: meId,
      kind: 'link',
      expiresAt,
      maxUses: 20,
    });
    const base = env.PUBLIC_WEB_URL || '';
    return { url: `${base}/f/${rawToken}`, expiresAt: invite.expiresAt };
  },


  async previewInvite(token: string) {
    const invite = await friendsRepository.findInviteByTokenHash(this.hashToken(token));
    const now = new Date();
    if (!invite || invite.revokedAt) throw new AppError('INVITE_INVALID', 'Invalid invite');
    if (invite.expiresAt.getTime() <= now.getTime()) throw new AppError('INVITE_EXPIRED', 'Invite expired');
    if (invite.uses >= invite.maxUses) throw new AppError('INVITE_EXPIRED', 'Invite expired');
    const owner = await userRepository.getOrThrow(invite.userId);
    if (owner.bannedAt) throw new AppError('INVITE_INVALID', 'Invalid invite');
    if (invite.kind === 'link' && !owner.friendsDiscoverable) throw new AppError('INVITE_INVALID', 'Invalid invite');
    return { displayName: owner.displayName, avatarInitials: owner.avatarInitials, kind: invite.kind };
  },

  async acceptInvite(meId: string, token: string) {
    requireFriendsEnabled(meId);
    const me = await userRepository.getOrThrow(meId);
    const invite = await friendsRepository.findInviteByTokenHash(this.hashToken(token));
    const now = new Date();
    if (!invite || invite.revokedAt) throw new AppError('INVITE_INVALID', 'Invalid invite');
    if (invite.expiresAt.getTime() <= now.getTime()) throw new AppError('INVITE_EXPIRED', 'Invite expired');
    if (invite.uses >= invite.maxUses) throw new AppError('INVITE_EXPIRED', 'Invite expired');
    const owner = await userRepository.getOrThrow(invite.userId);
    if (owner.bannedAt) throw new AppError('INVITE_INVALID', 'Invalid invite');
    if (invite.kind === 'link' && !owner.friendsDiscoverable) throw new AppError('INVITE_INVALID', 'Invalid invite');
    if (invite.userId === meId) throw new AppError('CANNOT_ADD_SELF', 'Cannot add yourself');

    const blocked = await friendsRepository.isBlockedEither(meId, owner.id);
    if (blocked) throw new AppError('BLOCKED', 'Blocked');

    const [meFriends, ownerFriends] = await Promise.all([
      friendsRepository.countAcceptedFriends(meId),
      friendsRepository.countAcceptedFriends(owner.id),
    ]);
    const mePremium = isPremiumActive(me, now);
    const ownerPremium = isPremiumActive(owner, now);
    if (!canBecomeFriends(meFriends, mePremium, ownerFriends, ownerPremium)) {
      throw new AppError('FRIEND_LIMIT', 'Friend limit reached');
    }

    // Incrément atomique de uses.
    const incremented = await friendsRepository.incrementInviteUse(invite.id);
    if (incremented === 0) throw new AppError('INVITE_EXPIRED', 'Invite expired');

    const { low, high } = orderPair(meId, owner.id);
    const existing = await friendsRepository.findPair(low, high);
    if (existing?.status === 'accepted') throw new AppError('ALREADY_FRIENDS', 'Already friends');

    if (invite.kind === 'qr') {
      // amitié immédiate
      if (existing?.status === 'pending') {
        const updated = await prisma.friendship.update({
          where: { id: existing.id },
          data: { status: 'accepted', acceptedAt: new Date(), source: 'qr' },
        });
        return { accepted: true, friendshipId: updated.id };
      }
      const created = await prisma.friendship.create({
        data: {
          userLowId: low,
          userHighId: high,
          requestedById: meId,
          status: 'accepted',
          source: 'qr',
          acceptedAt: new Date(),
        },
      });
      return { accepted: true, friendshipId: created.id };
    }

    // lien : crée/envoie une demande (pending)
    if (existing?.status === 'pending') {
      if (existing.requestedById === meId) throw new AppError('FRIEND_REQUEST_PENDING', 'Friend request already pending');
      // croisé → acceptation directe
      const updated = await prisma.friendship.update({
        where: { id: existing.id },
        data: { status: 'accepted', acceptedAt: new Date(), source: 'link' },
      });
      return { accepted: true, friendshipId: updated.id };
    }
    const created = await prisma.friendship.create({
      data: {
        userLowId: low,
        userHighId: high,
        requestedById: meId,
        status: 'pending',
        source: 'link',
      },
    });
    return { accepted: false, friendshipId: created.id, pending: true };
  },

  async revokeLinksForUser(userId: string) {
    await friendsRepository.revokeActiveLinksForUser(userId);
  },

  async block(meId: string, otherId: string) {
    requireFriendsEnabled(meId);
    if (meId === otherId) throw new AppError('CANNOT_ADD_SELF', 'Cannot block yourself');
    await friendsRepository.createBlock(meId, otherId);
    // révoque les invitations actives de l'autre vers moi / de moi vers l'autre
    await friendsRepository.revokeActiveLinksForUser(otherId);
    await friendsRepository.revokeActiveLinksForUser(meId);
    return { blocked: true };
  },

  async unblock(meId: string, otherId: string) {
    requireFriendsEnabled(meId);
    await friendsRepository.deleteBlock(meId, otherId);
    return { unblocked: true };
  },

  async listBlocks(meId: string) {
    requireFriendsEnabled(meId);
    const blocks = await friendsRepository.listBlocks(meId);
    const items = await Promise.all(
      blocks.map(async (b) => {
        const u = await userRepository.findById(b.blockedId);
        if (!u || u.bannedAt) return null;
        return { id: u.id, displayName: u.displayName, avatarInitials: u.avatarInitials };
      }),
    );
    return { items: items.filter(Boolean) };
  },

  async getFriendProfile(meId: string, otherId: string) {
    requireFriendsEnabled(meId);
    const { low, high } = orderPair(meId, otherId);
    const fri = await prisma.friendship.findUnique({
      where: { userLowId_userHighId: { userLowId: low, userHighId: high } },
    });
    if (!fri || fri.status !== 'accepted') throw new AppError('NOT_FOUND', 'Not friends');
    // bloqué → même 404
    if (await friendsRepository.isBlockedEither(meId, otherId)) throw new AppError('NOT_FOUND', 'Not friends');
    const user = await userRepository.getOrThrow(otherId);
    if (user.bannedAt) throw new AppError('NOT_FOUND', 'Not friends');
    const masteredSourates = await (async () => {
      try {
        const { getLearnedSourates } = await import('../me/learnedSourates.js');
        return await getLearnedSourates(otherId);
      } catch {
        return [];
      }
    })();
    const publicProfile = await toPublicProfile(user);
    return {
      user: publicProfile,
      masteredSourates,
      commonChallenges: [],
    };
  },

  async leaderboard(meId: string) {
    requireFriendsEnabled(meId);
    const accepted = await friendsRepository.listAccepted(meId, null, 200);
    const otherIds = accepted.map((f) => (f.userLowId === meId ? f.userHighId : f.userLowId));
    const ids = [meId, ...otherIds];
    const users = await prisma.user.findMany({
      where: { id: { in: ids }, bannedAt: null },
      select: { id: true, displayName: true, avatarInitials: true, username: true, streak: true, weeklyXp: true },
    });
    const blockedSet = new Set<string>();
    for (const u of users) {
      if (u.id !== meId && (await friendsRepository.isBlockedEither(meId, u.id))) blockedSet.add(u.id);
    }
    const filtered = users.filter((u) => !blockedSet.has(u.id));
    filtered.sort((a, b) => b.weeklyXp - a.weeklyXp);
    const items = filtered.map((u, idx) => ({
      rank: idx + 1,
      user: {
        id: u.id,
        displayName: u.displayName,
        username: u.username,
        avatarInitials: u.avatarInitials,
        streak: u.streak,
        learnedSouratesCount: 0,
        leagueTier: '',
        weeklyXp: u.weeklyXp,
      },
      weeklyXp: u.weeklyXp,
    }));
    return { items };
  },

  async summary(meId: string) {
    requireFriendsEnabled(meId);
    const pendingRequests = await prisma.friendship.count({
      where: { status: 'pending', OR: [{ userLowId: meId }, { userHighId: meId }], NOT: { requestedById: meId } },
    });
    return {
      pendingRequests,
      unreadMessages: 0,
      challengeInvites: 0,
      activeChallenges: 0,
      unseenFeed: 0,
    };
  },

  async getSettings(meId: string) {
    requireFriendsEnabled(meId);
    const u = await userRepository.getOrThrow(meId);
    return {
      friendsDiscoverable: u.friendsDiscoverable,
      friendsVisibility: u.friendsVisibility,
      notifFriends: u.notifFriends,
    };
  },

  async updateSettings(meId: string, input: any) {
    requireFriendsEnabled(meId);
    if (input.friendsDiscoverable === false) {
      await this.revokeLinksForUser(meId);
    }
    const updated = await userRepository.update(meId, {
      ...(input.friendsDiscoverable !== undefined ? { friendsDiscoverable: input.friendsDiscoverable } : {}),
      ...(input.friendsVisibility !== undefined ? { friendsVisibility: input.friendsVisibility } : {}),
      ...(input.notifFriends !== undefined ? { notifFriends: input.notifFriends } : {}),
    });
    return {
      friendsDiscoverable: updated.friendsDiscoverable,
      friendsVisibility: updated.friendsVisibility,
      notifFriends: updated.notifFriends,
    };
  },

  async createReport(meId: string, input: {
    targetUserId: string;
    targetKind: 'user' | 'message' | 'achievement';
    targetRef: string;
    reason: 'spam' | 'harassment' | 'inappropriate' | 'other';
    details?: string;
  }) {
    requireFriendsEnabled(meId);
    const me = await userRepository.getOrThrow(meId);
    const { start } = dayWindow(me, new Date());
    const count = await friendsRepository.countReportsToday(meId, start);
    if (count >= 10) throw new AppError('QUOTA_EXCEEDED', 'Daily report quota exceeded');
    const target = await userRepository.getOrThrow(input.targetUserId);
    if (target.bannedAt) throw new AppError('NOT_FOUND', 'User not found');
    const report = await friendsRepository.createReport({
      reporterId: meId,
      targetUserId: input.targetUserId,
      targetKind: input.targetKind,
      targetRef: input.targetRef,
      reason: input.reason,
      details: input.details,
    });
    return { reported: true, id: report.id };
  },
};

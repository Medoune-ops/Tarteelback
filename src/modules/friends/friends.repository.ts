import type { Prisma, FriendActivityType, ChallengeMetric, FriendSendType } from '@prisma/client';
import { prisma } from '../../config/prisma.js';
import { canonicalPair } from '../../core/friends.js';

/**
 * Champs publics d'un ami (jamais d'email/fuseau/gemmes/cœurs/abonnement).
 * Doit rester aligné sur `PublicUserRow` : la sortie réelle est de toute façon
 * filtrée par `serializePublicUser` (friends.serializer.ts) — règle 6.
 */
export const friendUserSelect = {
  id: true,
  displayName: true,
  username: true,
  avatarInitials: true,
} as const;

/** Client Prisma (pour accepter un client de transaction). */
type Db = Prisma.TransactionClient | typeof prisma;

export const friendsRepository = {
  // ── Code de partage ─────────────────────────────────────────────────────
  getCode(userId: string) {
    return prisma.friendCode.findUnique({ where: { userId } });
  },

  createCode(userId: string, code: string) {
    return prisma.friendCode.create({ data: { userId, code } });
  },

  updateCode(userId: string, code: string) {
    return prisma.friendCode.update({ where: { userId }, data: { code } });
  },

  /** Propriétaire d'un code, ou null si le code n'existe pas. */
  findCodeOwner(code: string) {
    return prisma.friendCode.findUnique({ where: { code }, select: { userId: true } });
  },

  // ── Amitiés ─────────────────────────────────────────────────────────────
  countFriends(userId: string) {
    return prisma.friendship.count({
      where: { OR: [{ user1Id: userId }, { user2Id: userId }] },
    });
  },

  findBetween(a: string, b: string) {
    const { user1Id, user2Id } = canonicalPair(a, b);
    return prisma.friendship.findUnique({ where: { user1Id_user2Id: { user1Id, user2Id } } });
  },

  /** Amitiés impliquant l'utilisateur, avec le profil public de l'ami. */
  list(userId: string) {
    return prisma.friendship.findMany({
      where: { OR: [{ user1Id: userId }, { user2Id: userId }] },
      include: {
        user1: { select: friendUserSelect },
        user2: { select: friendUserSelect },
      },
      orderBy: { createdAt: 'desc' },
    });
  },

  getById(id: string) {
    return prisma.friendship.findUnique({
      where: { id },
      include: {
        user1: { select: friendUserSelect },
        user2: { select: friendUserSelect },
      },
    });
  },

  create(a: string, b: string, db: Db = prisma) {
    const { user1Id, user2Id } = canonicalPair(a, b);
    return db.friendship.create({ data: { user1Id, user2Id } });
  },

  deleteById(id: string, db: Db = prisma) {
    return db.friendship.delete({ where: { id } });
  },

  // ── Blocage ─────────────────────────────────────────────────────────────
  /** Blocage dans un sens ou l'autre entre deux utilisateurs. */
  findBlockBetween(a: string, b: string) {
    return prisma.friendBlock.findFirst({
      where: {
        OR: [
          { blockerId: a, blockedId: b },
          { blockerId: b, blockedId: a },
        ],
      },
    });
  },

  listBlocksMade(userId: string) {
    return prisma.friendBlock.findMany({
      where: { blockerId: userId },
      include: { blocked: { select: friendUserSelect } },
      orderBy: { createdAt: 'desc' },
    });
  },

  upsertBlock(blockerId: string, blockedId: string) {
    return prisma.friendBlock.upsert({
      where: { blockerId_blockedId: { blockerId, blockedId } },
      create: { blockerId, blockedId },
      update: {},
    });
  },

  deleteBlock(blockerId: string, blockedId: string) {
    return prisma.friendBlock.deleteMany({ where: { blockerId, blockedId } });
  },

  // ── Signalement ─────────────────────────────────────────────────────────
  createReport(reporterId: string, reportedId: string, reason: string) {
    return prisma.friendReport.create({ data: { reporterId, reportedId, reason } });
  },

  // ── Profils publics ─────────────────────────────────────────────────────
  getUserPublic(userId: string) {
    return prisma.user.findUnique({ where: { id: userId }, select: friendUserSelect });
  },

  /** Ids de tous mes amis (peu importe le sens de la paire canonique). */
  async listFriendIds(userId: string): Promise<string[]> {
    const rows = await prisma.friendship.findMany({
      where: { OR: [{ user1Id: userId }, { user2Id: userId }] },
      select: { user1Id: true, user2Id: true },
    });
    return rows.map((r) => (r.user1Id === userId ? r.user2Id : r.user1Id));
  },

  // ── Fil d'activité (phase 2) ────────────────────────────────────────────
  createActivity(userId: string, type: FriendActivityType, data?: Prisma.InputJsonValue) {
    return prisma.friendActivity.create({ data: { userId, type, data } });
  },

  /** Une réussite « sourate maîtrisée » déjà publiée pour cette sourate ? */
  findSourateMasteredActivity(userId: string, numero: number) {
    return prisma.friendActivity.findFirst({
      where: { userId, type: 'sourate_mastered', data: { path: ['numero'], equals: numero } },
    });
  },

  /** Activités récentes des utilisateurs donnés (moi + mes amis). */
  listActivities(userIds: string[], limit: number) {
    return prisma.friendActivity.findMany({
      where: { userId: { in: userIds } },
      include: {
        user: { select: friendUserSelect },
        cheers: { select: { userId: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
  },

  getActivityById(id: string) {
    return prisma.friendActivity.findUnique({ where: { id }, include: { cheers: { select: { userId: true } } } });
  },

  upsertCheer(activityId: string, userId: string) {
    return prisma.friendActivityCheer.upsert({
      where: { activityId_userId: { activityId, userId } },
      create: { activityId, userId },
      update: {},
    });
  },

  deleteCheer(activityId: string, userId: string) {
    return prisma.friendActivityCheer.deleteMany({ where: { activityId, userId } });
  },

  // ── Défis (phase 3) ─────────────────────────────────────────────────────
  createChallenge(
    creatorId: string,
    input: { title: string; metric: ChallengeMetric; targetValue: number; endsAt: Date; sourateNumeros?: number[] },
    participantIds: string[],
  ) {
    const sourateNumeros = input.metric === 'sourates' && input.sourateNumeros
      ? Array.from(new Set(input.sourateNumeros)).sort((a,b)=>a-b)
      : [];
    const targetValue = input.metric === 'sourates' ? sourateNumeros.length : input.targetValue;
    return prisma.challenge.create({
      data: {
        creatorId,
        title: input.title,
        metric: input.metric,
        targetValue,
        sourateNumeros,
        endsAt: input.endsAt,
        entries: {
          create: participantIds.map((userId) => ({ userId })),
        },
      },
      include: {
        creator: { select: friendUserSelect },
        entries: {
          include: { user: { select: friendUserSelect } },
        },
      },
    });
  },

  listChallengesForUser(userId: string) {
    return prisma.challenge.findMany({
      where: { entries: { some: { userId } } },
      include: {
        creator: { select: friendUserSelect },
        entries: { include: { user: { select: friendUserSelect } }, orderBy: { progress: 'desc' } },
      },
      orderBy: { createdAt: 'desc' },
    });
  },

  getChallenge(id: string) {
    return prisma.challenge.findUnique({
      where: { id },
      include: {
        creator: { select: friendUserSelect },
        entries: { include: { user: { select: friendUserSelect } }, orderBy: { progress: 'desc' } },
      },
    });
  },

  findEntry(challengeId: string, userId: string) {
    return prisma.challengeParticipant.findUnique({
      where: { challengeId_userId: { challengeId, userId } },
    });
  },

  deleteEntry(challengeId: string, userId: string) {
    return prisma.challengeParticipant.deleteMany({ where: { challengeId, userId } });
  },

  updateChallenge(id: string, data: Prisma.ChallengeUpdateInput) {
    return prisma.challenge.update({ where: { id }, data });
  },

  /** Retire un utilisateur de TOUS les défis qu'il partage (blocage). */
  removeUserFromOwnChallengeEntries(userId: string) {
    return prisma.challengeParticipant.deleteMany({ where: { userId } });
  },

  // ── Messages « à un ami » (phase 4) ─────────────────────────────────────
  createMessage(
    tx: Db,
    data: { senderId: string; recipientId: string; type: FriendSendType; payload?: Prisma.InputJsonValue },
  ) {
    return tx.friendMessage.create({ data });
  },

  listInbox(userId: string, limit: number) {
    return prisma.friendMessage.findMany({
      where: { recipientId: userId },
      include: { sender: { select: friendUserSelect } },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
  },

  countUnread(userId: string) {
    return prisma.friendMessage.count({ where: { recipientId: userId, readAt: null } });
  },

  getMessage(id: string) {
    return prisma.friendMessage.findUnique({ where: { id } });
  },

  markMessageRead(id: string, recipientId: string) {
    return prisma.friendMessage.updateMany({
      where: { id, recipientId, readAt: null },
      data: { readAt: new Date() },
    });
  },
};

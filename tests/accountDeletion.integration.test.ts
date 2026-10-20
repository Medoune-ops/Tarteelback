/**
 * Ticket 5.2 — Suppression de compte COMPLET.
 * Tests d'intégration (skippés sauf RUN_DB_TESTS=1).
 *
 *   docker compose up -d
 *   npx prisma migrate deploy
 *   RUN_DB_TESTS=1 npx vitest run tests/accountDeletion.integration.test.ts
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { DB_TESTS, makeApp, resetDb, registerUser, authHeader } from './helpers/testApp.js';
import { prisma } from '../src/config/prisma.js';

const d = DB_TESTS ? describe : describe.skip;

function daysAgo(days: number): Date {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
}

async function createFullUserData(app: FastifyInstance, token: string, userId: string) {
  const friend = await registerUser(app);
  await prisma.friendship.create({
    data: {
      userLowId: userId < friend.userId ? userId : friend.userId,
      userHighId: userId < friend.userId ? friend.userId : userId,
      requestedById: userId,
      status: 'accepted',
      source: 'qr',
      createdAt: new Date(),
      acceptedAt: new Date(),
    },
  });

  // Défis
  const challenge = await prisma.challenge.create({
    data: {
      creatorId: userId,
      type: 'sourates',
      title: 'Défi test',
      goal: { sourateNumeros: [1, 2] },
      timezone: 'UTC',
      startDay: new Date().toISOString().slice(0, 10),
      endDay: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
      startsAt: new Date(),
      endsAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      status: 'active',
      winnerIds: [],
    },
  });
  await prisma.challengeParticipant.create({
    data: {
      challengeId: challenge.id,
      userId,
      status: 'accepted',
      baseline: 0,
      progress: 1,
      target: 1,
      invitedAt: new Date(),
      respondedAt: new Date(),
    },
  });

  // Messages
  await prisma.friendMessage.create({
    data: {
      senderId: userId,
      recipientId: friend.userId,
      kind: 'hadith',
      payload: { collection: 'nawawi', n: 1 },
      note: 'Un hadith',
    },
  });
  await prisma.friendMessage.create({
    data: {
      senderId: friend.userId,
      recipientId: userId,
      kind: 'encouragement',
      payload: { key: 'keep_going' },
    },
  });

  // Invitations
  await prisma.friendInvite.create({
    data: {
      tokenHash: 'invite-token-1',
      userId,
      kind: 'qr',
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      maxUses: 1,
      uses: 0,
    },
  });
  await prisma.householdInvitation.create({
    data: {
      householdId: 'household-1',
      email: 'invite@example.com',
      token: 'household-invite-token',
      status: 'pending',
      invitedById: userId,
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    },
  });

  // Blocages
  await prisma.userBlock.create({
    data: { blockerId: userId, blockedId: friend.userId },
    createdAt: new Date(),
  });

  // Signalements
  await prisma.report.create({
    data: {
      reporterId: userId,
      targetUserId: friend.userId,
      targetKind: 'user',
      targetRef: friend.userId,
      reason: 'spam',
      details: 'Spam signalé',
      status: 'open',
      createdAt: new Date(),
    },
  });

  // Progression
  await prisma.activityDay.create({
    data: { userId, day: new Date().toISOString().slice(0, 10) },
  });
  await prisma.lessonProgress.create({
    data: {
      userId,
      lessonId: 'lesson-1',
      etat: 'completed',
      score: 100,
      completedAt: new Date(),
    },
  });
  await prisma.sourateRevision.create({
    data: {
      userId,
      sourateId: 'sourate-1',
      segmentIndex: 0,
      score: 80,
      etat: 'maitrise',
      prochaineRevision: new Date(Date.now() + 24 * 60 * 60 * 1000),
      intervalleJours: 1,
    },
  });
  await prisma.lettreRevision.create({
    data: {
      userId,
      lessonId: 'lesson-1',
      score: 90,
      etat: 'maitrise',
      prochaineRevision: new Date(Date.now() + 24 * 60 * 60 * 1000),
      intervalleJours: 1,
    },
  });
  await prisma.podiumReward.create({
    data: {
      userId,
      ref: 'w23',
      semaine: 23,
      ligue: 'or',
      rang: 1,
      xp: 1000,
      reward: 500,
    },
  });

  // Gemmes et transactions
  await prisma.gemTransaction.create({
    data: {
      userId,
      amount: 50,
      reason: 'lesson_complete',
      ref: 'lesson-1',
      createdAt: new Date(),
    },
  });
  await prisma.transaction.create({
    data: {
      userId,
      type: 'gem_pack',
      montant: 499,
      devise: 'EUR',
      statut: 'success',
      providerRef: 'tx-1',
      createdAt: new Date(),
    },
  });

  // DomainEvent
  await prisma.domainEvent.create({
    data: {
      type: 'test.event',
      userId,
      payload: { key: 'value' },
      processedAt: new Date(),
      createdAt: new Date(),
    },
  });

  // Quotas
  await prisma.dailyQuota.create({
    data: { userId, day: new Date(), count: 1 },
  });
  await prisma.dailyRecipientQuota.create({
    data: { userId, recipientId: friend.userId, day: new Date(), count: 1 },
  });

  // Sessions et tokens
  await prisma.refreshToken.create({
    data: {
      userId,
      tokenHash: 'refresh-token-hash',
      deviceId: 'device-1',
      expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    },
  });
  await prisma.deviceToken.create({
    data: {
      userId,
      token: 'ExponentPushToken[device-1]',
      deviceId: 'device-1',
      platform: 'ios',
      createdAt: new Date(),
    },
  });

  // Ménage
  await prisma.supportMessage.create({
    data: { userId, message: 'Message support', fromAdmin: false, read: false },
  });
  await prisma.pendingGift.create({
    data: { userId, kind: 'hearts', amount: 5 },
  });
  await prisma.passwordResetToken.create({
    data: {
      userId,
      tokenHash: 'reset-token-hash',
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    },
  });
  await prisma.emailVerificationCode.create({
    data: {
      userId,
      codeHash: 'code-hash',
      attempts: 0,
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    },
  });
}

d('suppression de compte COMPLET (ticket 5.2)', () => {
  let app: FastifyInstance;
  beforeAll(async () => { app = await makeApp(); });
  afterAll(async () => { await app.close(); });
  beforeEach(async () => { await resetDb(); });

  it('DELETE /me supprime le compte et toutes les entités liées', async () => {
    const user = await registerUser(app, { password: 'password123' });
    await createFullUserData(app, user.accessToken, user.userId);

    // Vérifier que les données existent avant suppression
    const beforeUser = await prisma.user.findUnique({ where: { id: user.userId } });
    expect(beforeUser).not.toBeNull();

    const beforeFriendship = await prisma.friendship.count({
      where: { OR: [{ userLowId: user.userId }, { userHighId: user.userId }] },
    });
    expect(beforeFriendship).toBeGreaterThan(0);

    const beforeChallenge = await prisma.challenge.count({
      where: { creatorId: user.userId },
    });
    expect(beforeChallenge).toBeGreaterThan(0);

    // Supprimer le compte
    const res = await app.inject({
      method: 'DELETE',
      url: '/me',
      headers: authHeader(user.accessToken),
      payload: { password: 'password123' },
    });

    expect(res.statusCode).toBe(204);

    // Vérifier que l'utilisateur n'existe plus
    const afterUser = await prisma.user.findUnique({ where: { id: user.userId } });
    expect(afterUser).toBeNull();

    // Vérifier que toutes les entités liées sont supprimées (cascade)
    const afterFriendship = await prisma.friendship.count({
      where: { OR: [{ userLowId: user.userId }, { userHighId: user.userId }] },
    });
    expect(afterFriendship).toBe(0);

    const afterChallenge = await prisma.challenge.count({
      where: { creatorId: user.userId },
    });
    expect(afterChallenge).toBe(0);

    const afterChallengeParticipant = await prisma.challengeParticipant.count({
      where: { userId: user.userId },
    });
    expect(afterChallengeParticipant).toBe(0);

    const afterMessageSent = await prisma.friendMessage.count({
      where: { senderId: user.userId },
    });
    expect(afterMessageSent).toBe(0);
    const afterMessageReceived = await prisma.friendMessage.count({
      where: { recipientId: user.userId },
    });
    expect(afterMessageReceived).toBe(0);

    const afterInvite = await prisma.friendInvite.count({ where: { userId: user.userId } });
    expect(afterInvite).toBe(0);
    const afterHouseholdInvite = await prisma.householdInvitation.count({
      where: { invitedById: user.userId },
    });
    expect(afterHouseholdInvite).toBe(0);

    const afterBlockGiven = await prisma.userBlock.count({ where: { blockerId: user.userId } });
    expect(afterBlockGiven).toBe(0);
    const afterBlockReceived = await prisma.userBlock.count({ where: { blockedId: user.userId } });
    expect(afterBlockReceived).toBe(0);

    const afterReportSent = await prisma.report.count({ where: { reporterId: user.userId } });
    expect(afterReportSent).toBe(0);
    const afterReportReceived = await prisma.report.count({ where: { targetUserId: user.userId } });
    expect(afterReportReceived).toBe(0);

    const afterActivityDay = await prisma.activityDay.count({ where: { userId: user.userId } });
    expect(afterActivityDay).toBe(0);
    const afterLessonProgress = await prisma.lessonProgress.count({ where: { userId: user.userId } });
    expect(afterLessonProgress).toBe(0);
    const afterSourateRevision = await prisma.sourateRevision.count({ where: { userId: user.userId } });
    expect(afterSourateRevision).toBe(0);
    const afterLettreRevision = await prisma.lettreRevision.count({ where: { userId: user.userId } });
    expect(afterLettreRevision).toBe(0);
    const afterPodiumReward = await prisma.podiumReward.count({ where: { userId: user.userId } });
    expect(afterPodiumReward).toBe(0);

    const afterGemTransaction = await prisma.gemTransaction.count({ where: { userId: user.userId } });
    expect(afterGemTransaction).toBe(0);
    const afterTransaction = await prisma.transaction.count({ where: { userId: user.userId } });
    expect(afterTransaction).toBe(0);

    const afterDomainEvent = await prisma.domainEvent.count({ where: { userId: user.userId } });
    expect(afterDomainEvent).toBe(0);

    const afterDailyQuota = await prisma.dailyQuota.count({ where: { userId: user.userId } });
    expect(afterDailyQuota).toBe(0);
    const afterDailyRecipientQuota = await prisma.dailyRecipientQuota.count({
      where: { userId: user.userId },
    });
    expect(afterDailyRecipientQuota).toBe(0);

    const afterRefreshToken = await prisma.refreshToken.count({ where: { userId: user.userId } });
    expect(afterRefreshToken).toBe(0);
    const afterDeviceToken = await prisma.deviceToken.count({ where: { userId: user.userId } });
    expect(afterDeviceToken).toBe(0);

    const afterSupportMessage = await prisma.supportMessage.count({ where: { userId: user.userId } });
    expect(afterSupportMessage).toBe(0);
    const afterPendingGift = await prisma.pendingGift.count({ where: { userId: user.userId } });
    expect(afterPendingGift).toBe(0);
    const afterPasswordReset = await prisma.passwordResetToken.count({ where: { userId: user.userId } });
    expect(afterPasswordReset).toBe(0);
    const afterEmailVerification = await prisma.emailVerificationCode.count({
      where: { userId: user.userId },
    });
    expect(afterEmailVerification).toBe(0);
  });
});

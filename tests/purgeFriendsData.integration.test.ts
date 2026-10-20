/**
 * Ticket 5.1 — Job purgeFriendsData.
 * Tests d'intégration (skippés sauf RUN_DB_TESTS=1).
 *
 *   docker compose up -d
 *   npx prisma migrate deploy
 *   RUN_DB_TESTS=1 npx vitest run tests/purgeFriendsData.integration.test.ts
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { DB_TESTS, makeApp, resetDb, registerUser, authHeader } from './helpers/testApp.js';
import { prisma } from '../src/config/prisma.js';
import { purgeFriendsData } from '../src/jobs/maintenance.js';

const d = DB_TESTS ? describe : describe.skip;

function daysAgo(days: number): Date {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
}

d('purgeFriendsData (ticket 5.1)', () => {
  let app: FastifyInstance;
  beforeAll(async () => { app = await makeApp(); });
  afterAll(async () => { await app.close(); });
  beforeEach(async () => { await resetDb(); });

  it('supprime les événements traités >14j, invitations expirées, messages masqués >90j', async () => {
    const me = await registerUser(app);
    const friend = await registerUser(app);

    // ── DomainEvent : traités >14j (supprimés) vs récents (gardés) ──
    await prisma.domainEvent.create({
      data: {
        type: 'test.event',
        userId: me.userId,
        payload: {},
        processedAt: daysAgo(15),
      },
    });
    await prisma.domainEvent.create({
      data: {
        type: 'test.event',
        userId: me.userId,
        payload: {},
        processedAt: daysAgo(10), // récent, gardé
      },
    });

    // ── FriendInvite : expirée (supprimée) vs valide (gardée) ──
    await prisma.friendInvite.create({
      data: {
        tokenHash: 'expired-token',
        userId: me.userId,
        kind: 'qr',
        expiresAt: daysAgo(1), // expirée
        maxUses: 1,
        uses: 0,
      },
    });
    await prisma.friendInvite.create({
      data: {
        tokenHash: 'valid-token',
        userId: me.userId,
        kind: 'qr',
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // valide
        maxUses: 1,
        uses: 0,
      },
    });

    // ── FriendMessage : masqué >90j (supprimé) vs récent (gardé) ──
    await prisma.friendMessage.create({
      data: {
        senderId: me.userId,
        recipientId: friend.userId,
        kind: 'encouragement',
        payload: { key: 'keep_going' },
        hiddenAt: daysAgo(91), // masqué depuis plus de 90j
      },
    });
    await prisma.friendMessage.create({
      data: {
        senderId: me.userId,
        recipientId: friend.userId,
        kind: 'hadith',
        payload: { collection: 'nawawi', n: 1 },
        hiddenAt: daysAgo(10), // masqué récemment, gardé
      },
    });
    await prisma.friendMessage.create({
      data: {
        senderId: me.userId,
        recipientId: friend.userId,
        kind: 'achievement',
        payload: { achievementId: 'some-achievement' },
        // pas de hiddenAt, gardé
      },
    });

    const result = await purgeFriendsData(new Date());
    expect(result).not.toBeNull();
    expect(result!.deletedEvents).toBe(1);
    expect(result!.deletedInvites).toBe(1);
    expect(result!.deletedMessages).toBe(1);

    // Vérifier ce qui reste
    const remainingEvents = await prisma.domainEvent.count();
    expect(remainingEvents).toBe(1); // l'événement récent

    const remainingInvites = await prisma.friendInvite.count();
    expect(remainingInvites).toBe(1); // l'invitation valide

    const remainingMessages = await prisma.friendMessage.count();
    expect(remainingMessages).toBe(2); // message masqué récent + message non masqué
  });

  it('est idempotent : relancer ne supprime rien de plus', async () => {
    const me = await registerUser(app);

    await prisma.domainEvent.create({
      data: {
        type: 'test.event',
        userId: me.userId,
        payload: {},
        processedAt: daysAgo(15),
      },
    });

    const r1 = await purgeFriendsData(new Date());
    expect(r1).not.toBeNull();
    expect(r1!.deletedEvents).toBe(1);

    const r2 = await purgeFriendsData(new Date());
    expect(r2).not.toBeNull();
    expect(r2!.deletedEvents).toBe(0);
    expect(r2!.deletedInvites).toBe(0);
    expect(r2!.deletedMessages).toBe(0);
  });
});

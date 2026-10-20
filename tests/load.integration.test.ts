/**
 * Ticket 5.2 — Test de charge et EXPLAIN.
 * Tests d'intégration (skippés sauf RUN_DB_TESTS=1).
 *
 *   docker compose up -d
 *   npx prisma migrate deploy
 *   RUN_DB_TESTS=1 npx vitest run tests/load.integration.test.ts
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { DB_TESTS, makeApp, resetDb, registerUser, authHeader } from './helpers/testApp.js';
import { prisma } from '../src/config/prisma.js';

const d = DB_TESTS ? describe : describe.skip;

function explainRowToText(row: any): string {
  const val = Object.values(row)[0];
  return val === undefined || val === null ? '' : String(val);
}

d('charge et EXPLAIN requêtes fréquentes (ticket 5.2)', () => {
  let app: FastifyInstance;
  beforeAll(async () => { app = await makeApp(); });
  afterAll(async () => { await app.close(); });
  beforeEach(async () => { await resetDb(); });

  it('charge : 20 amis, 1 000 défis actifs, 10 000 événements', async () => {
    const me = await registerUser(app);

    // 20 amis acceptés
    const friends = await Promise.all(Array.from({ length: 20 }, () => registerUser(app)));
    for (const f of friends) {
      const low = me.userId < f.userId ? me.userId : f.userId;
      const high = me.userId < f.userId ? f.userId : me.userId;
      await prisma.friendship.create({
        data: { userLowId: low, userHighId: high, requestedById: me.userId, status: 'accepted', source: 'qr', createdAt: new Date(), acceptedAt: new Date() },
      });
    }

    const friendCount = await prisma.friendship.count({
      where: { OR: [{ userLowId: me.userId }, { userHighId: me.userId }], status: 'accepted' },
    });
    expect(friendCount).toBe(20);

    // 1 000 défis actifs dont l'utilisateur est créateur
    for (let i = 0; i < 1000; i++) {
      await prisma.challenge.create({
        data: {
          creatorId: me.userId,
          type: 'sourates',
          title: `Défi ${i}`,
          goal: { sourateNumeros: [1] },
          timezone: 'UTC',
          startDay: new Date().toISOString().slice(0, 10),
          endDay: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
          startsAt: new Date(),
          endsAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
          status: 'active',
          winnerIds: [],
        },
      });
    }

    const challengeCount = await prisma.challenge.count({
      where: { creatorId: me.userId, status: 'active' },
    });
    expect(challengeCount).toBe(1000);

    // 10 000 DomainEvent
    for (let i = 0; i < 10000; i++) {
      await prisma.domainEvent.create({
        data: { type: 'test.event', userId: me.userId, payload: { i }, createdAt: new Date() },
      });
    }

    const eventCount = await prisma.domainEvent.count({ where: { userId: me.userId } });
    expect(eventCount).toBe(10000);
  });

  it('EXPLAIN : fil d\'amis utilise un index (pas de Seq Scan)', async () => {
    const me = await registerUser(app);
    const friends = await Promise.all(Array.from({ length: 20 }, () => registerUser(app)));
    for (const f of friends) {
      const low = me.userId < f.userId ? me.userId : f.userId;
      const high = me.userId < f.userId ? f.userId : me.userId;
      await prisma.friendship.create({
        data: { userLowId: low, userHighId: high, requestedById: me.userId, status: 'accepted', source: 'qr', createdAt: new Date(), acceptedAt: new Date() },
      });
    }

    const explain = (await prisma.$queryRawUnsafe(
      `EXPLAIN (FORMAT TEXT) SELECT * FROM "Friendship" WHERE ("userLowId" = '${me.userId}' OR "userHighId" = '${me.userId}') AND status = 'accepted' LIMIT 50`,
    )) as any[];
    const explainText = explain.map(explainRowToText).join('\n');
    expect(explainText).not.toContain('Seq Scan on "Friendship"');
  });

  it('EXPLAIN : liste de défis utilise un index (pas de Seq Scan)', async () => {
    const me = await registerUser(app);
    for (let i = 0; i < 100; i++) {
      await prisma.challenge.create({
        data: {
          creatorId: me.userId,
          type: 'sourates',
          title: `Défi ${i}`,
          goal: { sourateNumeros: [1] },
          timezone: 'UTC',
          startDay: new Date().toISOString().slice(0, 10),
          endDay: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
          startsAt: new Date(),
          endsAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
          status: 'active',
          winnerIds: [],
        },
      });
    }

    const explain = (await prisma.$queryRawUnsafe(
      `EXPLAIN (FORMAT TEXT) SELECT * FROM "Challenge" WHERE "creatorId" = '${me.userId}' AND status = 'active' ORDER BY "createdAt" DESC LIMIT 20`,
    )) as any[];
    const explainText = explain.map(explainRowToText).join('\n');
    expect(explainText).not.toContain('Seq Scan on "Challenge"');
  });

  it('EXPLAIN : boîte de messages utilise un index (pas de Seq Scan)', async () => {
    const me = await registerUser(app);
    const sender = await registerUser(app);
    for (let i = 0; i < 100; i++) {
      await prisma.friendMessage.create({
        data: {
          senderId: sender.userId,
          recipientId: me.userId,
          kind: 'hadith',
          payload: { collection: 'nawawi', n: 1 },
        },
      });
    }

    const explain = (await prisma.$queryRawUnsafe(
      `EXPLAIN (FORMAT TEXT) SELECT * FROM "FriendMessage" WHERE "recipientId" = '${me.userId}' AND "hiddenAt" IS NULL ORDER BY "createdAt" DESC LIMIT 20`,
    )) as any[];
    const explainText = explain.map(explainRowToText).join('\n');
    expect(explainText).not.toContain('Seq Scan on "FriendMessage"');
  });

  it('EXPLAIN : demandes d\'amitié pending utilise un index (pas de Seq Scan)', async () => {
    const me = await registerUser(app);
    const friends = await Promise.all(Array.from({ length: 10 }, () => registerUser(app)));
    for (const f of friends) {
      const low = me.userId < f.userId ? me.userId : f.userId;
      const high = me.userId < f.userId ? f.userId : me.userId;
      await prisma.friendship.create({
        data: { userLowId: low, userHighId: high, requestedById: f.userId, status: 'pending', source: 'qr', createdAt: new Date() },
      });
    }

    const explain = (await prisma.$queryRawUnsafe(
      `EXPLAIN (FORMAT TEXT) SELECT * FROM "Friendship" WHERE ("userLowId" = '${me.userId}' OR "userHighId" = '${me.userId}') AND status = 'pending' AND "requestedById" <> '${me.userId}'`,
    )) as any[];
    const explainText = explain.map(explainRowToText).join('\n');
    expect(explainText).not.toContain('Seq Scan on "Friendship"');
  });
});

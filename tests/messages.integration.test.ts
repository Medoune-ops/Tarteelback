/**
 * Ticket 4.B2 — messages : envoi, lecture, masquage.
 * Tests d'intégration (skippés sauf RUN_DB_TESTS=1).
 *
 *   docker compose up -d
 *   npx prisma migrate deploy
 *   RUN_DB_TESTS=1 npx vitest run tests/messages.integration.test.ts
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { DB_TESTS, makeApp, resetDb, registerUser, authHeader } from './helpers/testApp.js';
import { prisma } from '../src/config/prisma.js';

const d = DB_TESTS ? describe : describe.skip;

async function makeUserWithToken(app: FastifyInstance, overrides: { timezone?: string; premium?: boolean } = {}) {
  const user = await registerUser(app);
  if (overrides.timezone || overrides.premium) {
    await prisma.user.update({
      where: { id: user.userId },
      data: {
        ...(overrides.timezone ? { timezone: overrides.timezone } : {}),
        ...(overrides.premium ? { isPremium: true, premiumUntil: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000) } : {}),
      },
    });
  }
  return user;
}

async function befriend(aId: string, bId: string) {
  const low = aId < bId ? aId : bId;
  const high = aId < bId ? bId : aId;
  await prisma.friendship.create({
    data: { userLowId: low, userHighId: high, requestedById: aId, status: 'accepted', source: 'qr', createdAt: new Date(), acceptedAt: new Date() },
  });
}

async function block(aId: string, bId: string) {
  const blockerId = aId < bId ? aId : bId;
  const blockedId = aId < bId ? bId : aId;
  await prisma.userBlock.create({
    data: { blockerId, blockedId },
  });
}

function todayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

async function setDailyQuota(userId: string, count: number) {
  await prisma.dailyQuota.upsert({
    where: { userId_day: { userId, day: new Date(todayKey() + 'T00:00:00.000Z') } },
    create: { userId, day: new Date(todayKey() + 'T00:00:00.000Z'), count },
    update: { count },
  });
}

async function sendMessage(app: FastifyInstance, token: string, payload: any) {
  return app.inject({
    method: 'POST',
    url: '/me/messages',
    headers: authHeader(token),
    payload,
  });
}

d('messages : envoi, lecture, masquage (ticket 4.B2)', () => {
  let app: FastifyInstance;
  beforeAll(async () => { app = await makeApp(); });
  afterAll(async () => { await app.close(); });
  beforeEach(async () => { await resetDb(); });

  it('POST /me/messages : envoi à 3 amis = 3 envois', async () => {
    const me = await makeUserWithToken(app);
    const f1 = await makeUserWithToken(app);
    const f2 = await makeUserWithToken(app);
    const f3 = await makeUserWithToken(app);
    await befriend(me.userId, f1.userId);
    await befriend(me.userId, f2.userId);
    await befriend(me.userId, f3.userId);

    const res = await sendMessage(app, me.accessToken, {
      recipientIds: [f1.userId, f2.userId, f3.userId],
      kind: 'encouragement',
      payload: { key: 'keep_going' },
      note: 'Courage !',
    });

    expect(res.statusCode).toBe(201);
    expect(res.json().sent).toBe(3);
    expect(res.json().recipients).toBe(3);

    const messages = await prisma.friendMessage.findMany({
      where: { senderId: me.userId },
    });
    expect(messages.length).toBe(3);
  });

  it('POST /me/messages : gratuit avec 2 envois restants et 3 destinataires => tout refusé', async () => {
    const me = await makeUserWithToken(app);
    const f1 = await makeUserWithToken(app);
    const f2 = await makeUserWithToken(app);
    const f3 = await makeUserWithToken(app);
    await befriend(me.userId, f1.userId);
    await befriend(me.userId, f2.userId);
    await befriend(me.userId, f3.userId);

    // Simuler 1 envoi déjà fait aujourd'hui (3 - 1 = 2 restants, < 3 destinataires)
    await setDailyQuota(me.userId, 1);

    const res = await sendMessage(app, me.accessToken, {
      recipientIds: [f1.userId, f2.userId, f3.userId],
      kind: 'encouragement',
      payload: { key: 'keep_going' },
    });

    expect(res.statusCode).toBe(429);
    expect(res.json().error.code).toBe('QUOTA_EXCEEDED');

    // Vérifier qu'aucun message n'a été créé
    const messages = await prisma.friendMessage.findMany({
      where: { senderId: me.userId },
    });
    expect(messages.length).toBe(0);
  });

  it('POST /me/messages : 4e envoi du jour en gratuit => 429', async () => {
    const me = await makeUserWithToken(app);
    const f1 = await makeUserWithToken(app);
    await befriend(me.userId, f1.userId);

    // Simuler 3 envois déjà faits aujourd'hui (quota gratuit = 3)
    await setDailyQuota(me.userId, 3);

    const res = await sendMessage(app, me.accessToken, {
      recipientIds: [f1.userId],
      kind: 'encouragement',
      payload: { key: 'keep_going' },
    });

    expect(res.statusCode).toBe(429);
    expect(res.json().error.code).toBe('QUOTA_EXCEEDED');
  });

  it('POST /me/messages : 31e en premium => 429', async () => {
    const me = await makeUserWithToken(app, { premium: true });
    const f1 = await makeUserWithToken(app);
    await befriend(me.userId, f1.userId);

    // Simuler 30 envois déjà faits aujourd'hui (quota premium = 30)
    await setDailyQuota(me.userId, 30);

    const res = await sendMessage(app, me.accessToken, {
      recipientIds: [f1.userId],
      kind: 'encouragement',
      payload: { key: 'keep_going' },
    });

    expect(res.statusCode).toBe(429);
    expect(res.json().error.code).toBe('QUOTA_EXCEEDED');
  });

  it('POST /me/messages : non-ami refusé', async () => {
    const me = await makeUserWithToken(app);
    const stranger = await registerUser(app);

    const res = await sendMessage(app, me.accessToken, {
      recipientIds: [stranger.userId],
      kind: 'encouragement',
      payload: { key: 'keep_going' },
    });

    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('NOT_FRIENDS');
  });

  it('POST /me/messages : bloqué refusé', async () => {
    const me = await makeUserWithToken(app);
    const blocked = await makeUserWithToken(app);
    await block(me.userId, blocked.userId);

    const res = await sendMessage(app, me.accessToken, {
      recipientIds: [blocked.userId],
      kind: 'encouragement',
      payload: { key: 'keep_going' },
    });

    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('BLOCKED');
  });

  it('POST /me/messages : note de 141 caractères refusée', async () => {
    const me = await makeUserWithToken(app);
    const f1 = await makeUserWithToken(app);
    await befriend(me.userId, f1.userId);

    const longNote = 'a'.repeat(141);

    const res = await sendMessage(app, me.accessToken, {
      recipientIds: [f1.userId],
      kind: 'encouragement',
      payload: { key: 'keep_going' },
      note: longNote,
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('VALIDATION_ERROR');
  });

  it('POST /me/messages : collection inconnue refusée', async () => {
    const me = await makeUserWithToken(app);
    const f1 = await makeUserWithToken(app);
    await befriend(me.userId, f1.userId);

    const res = await sendMessage(app, me.accessToken, {
      recipientIds: [f1.userId],
      kind: 'hadith',
      payload: { collection: 'inconnue', n: 1 },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('VALIDATION_ERROR');
  });

  it('GET /me/messages : liste les messages reçus non masqués', async () => {
    const me = await makeUserWithToken(app);
    const sender = await makeUserWithToken(app);
    await befriend(sender.userId, me.userId);

    await prisma.friendMessage.create({
      data: {
        senderId: sender.userId,
        recipientId: me.userId,
        kind: 'encouragement',
        payload: { key: 'proud_of_you' },
        note: 'Bien joué !',
      },
    });
    await prisma.friendMessage.create({
      data: {
        senderId: sender.userId,
        recipientId: me.userId,
        kind: 'encouragement',
        payload: { key: 'keep_going' },
        note: 'Continue !',
        hiddenAt: new Date(),
      },
    });

    const res = await app.inject({
      method: 'GET',
      url: '/me/messages',
      headers: authHeader(me.accessToken),
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.items).toHaveLength(1);
    expect(body.items[0].note).toBe('Bien joué !');
    expect(body.items[0].readAt).toBeNull();
  });

  it('POST /me/messages/:id/read : marque comme lu', async () => {
    const me = await makeUserWithToken(app);
    const sender = await makeUserWithToken(app);
    await befriend(sender.userId, me.userId);

    const message = await prisma.friendMessage.create({
      data: {
        senderId: sender.userId,
        recipientId: me.userId,
        kind: 'hadith',
        payload: { collection: 'nawawi', n: 1 },
      },
    });

    const res = await app.inject({
      method: 'POST',
      url: `/me/messages/${message.id}/read`,
      headers: authHeader(me.accessToken),
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().read).toBe(true);

    const updated = await prisma.friendMessage.findUnique({ where: { id: message.id } });
    expect(updated!.readAt).not.toBeNull();
  });

  it('POST /me/messages/:id/read : destinataire seulement', async () => {
    const me = await makeUserWithToken(app);
    const sender = await makeUserWithToken(app);
    const other = await makeUserWithToken(app);
    await befriend(sender.userId, me.userId);

    const message = await prisma.friendMessage.create({
      data: {
        senderId: sender.userId,
        recipientId: me.userId,
        kind: 'hadith',
        payload: { collection: 'nawawi', n: 1 },
      },
    });

    const res = await app.inject({
      method: 'POST',
      url: `/me/messages/${message.id}/read`,
      headers: authHeader(other.accessToken),
    });

    expect(res.statusCode).toBe(404);
  });

  it('DELETE /me/messages/:id : masque le message (destinataire seulement)', async () => {
    const me = await makeUserWithToken(app);
    const sender = await makeUserWithToken(app);
    await befriend(sender.userId, me.userId);

    const message = await prisma.friendMessage.create({
      data: {
        senderId: sender.userId,
        recipientId: me.userId,
        kind: 'hadith',
        payload: { collection: 'nawawi', n: 1 },
      },
    });

    const res = await app.inject({
      method: 'DELETE',
      url: `/me/messages/${message.id}`,
      headers: authHeader(me.accessToken),
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().removed).toBe(true);

    const updated = await prisma.friendMessage.findUnique({ where: { id: message.id } });
    expect(updated!.hiddenAt).not.toBeNull();
  });

  it('DELETE /me/messages/:id : non-destinataire refusé', async () => {
    const me = await makeUserWithToken(app);
    const sender = await makeUserWithToken(app);
    const other = await makeUserWithToken(app);
    await befriend(sender.userId, me.userId);

    const message = await prisma.friendMessage.create({
      data: {
        senderId: sender.userId,
        recipientId: me.userId,
        kind: 'hadith',
        payload: { collection: 'nawawi', n: 1 },
      },
    });

    const res = await app.inject({
      method: 'DELETE',
      url: `/me/messages/${message.id}`,
      headers: authHeader(other.accessToken),
    });

    expect(res.statusCode).toBe(404);
  });

  it('summary : unreadMessages devient réel', async () => {
    const me = await makeUserWithToken(app);
    const sender = await makeUserWithToken(app);
    await befriend(sender.userId, me.userId);

    await prisma.friendMessage.create({
      data: {
        senderId: sender.userId,
        recipientId: me.userId,
        kind: 'hadith',
        payload: { collection: 'nawawi', n: 1 },
      },
    });
    await prisma.friendMessage.create({
      data: {
        senderId: sender.userId,
        recipientId: me.userId,
        kind: 'hadith',
        payload: { collection: 'nawawi', n: 2 },
        readAt: new Date(),
      },
    });

    // Le summary est dans le module friends. On l'appelle via friends.service
    const { friendsService } = await import('../src/modules/friends/friends.service.js');
    const summary = await friendsService.summary(me.userId);
    expect(summary.unreadMessages).toBe(1);
  });
});

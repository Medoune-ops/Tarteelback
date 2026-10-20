/**
 * Ticket 3.B3 — défis : aperçu, création, lecture.
 * Tests d'intégration (skippés sauf RUN_DB_TESTS=1).
 *
 *   docker compose up -d
 *   npx prisma migrate deploy
 *   RUN_DB_TESTS=1 npx vitest run tests/challenges.integration.test.ts
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { DB_TESTS, makeApp, resetDb, registerUser, authHeader } from './helpers/testApp.js';
import { prisma } from '../src/config/prisma.js';
import { finishChallenge } from '../src/modules/challenges/challenges.progress.js';
import { finalizeChallenges } from '../src/jobs/maintenance.js';

const d = DB_TESTS ? describe : describe.skip;

// --- mock de la maîtrise des sourates (contrôle alreadyMasteredBy / progress) ---
// L'usine est en ligne : vi.mock est hissé au sommet du fichier par vitest, elle
// ne doit référencer aucune variable déclarée plus bas.
vi.mock('../src/modules/me/learnedSourates.js', () => ({
  getLearnedSourates: vi.fn(async (_userId: string): Promise<LearnedSourate[]> => []),
}));
import { getLearnedSourates, type LearnedSourate } from '../src/modules/me/learnedSourates.js';
const learned = vi.mocked(getLearnedSourates);

/** YYYY-MM-DD du lendemain, heure UTC (Dakar = UTC, pas de DST). */
function tomorrowKey(): string {
  return new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

// Règle sous test (à figer) : endDay = startDay + (durationDays - 1) jours calendaires.
function addCalendarDays(key: string, days: number): string {
  const date = new Date(`${key}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

async function makeUser(app: FastifyInstance, overrides: { timezone?: string; premium?: boolean } = {}) {
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

/** Amitié acceptée (modèle Friendship : userLowId / userHighId). */
async function befriend(aId: string, bId: string) {
  const low = aId < bId ? aId : bId;
  const high = aId < bId ? bId : aId;
  await prisma.friendship.create({
    data: { userLowId: low, userHighId: high, requestedById: aId, status: 'accepted', source: 'qr', createdAt: new Date(), acceptedAt: new Date() },
  });
}

async function createChallenge(app: FastifyInstance, me: { accessToken: string; userId: string }, invitees: { userId: string }[], overrides: Record<string, unknown> = {}) {
  return app.inject({
    method: 'POST',
    url: '/me/challenges',
    headers: authHeader(me.accessToken),
    payload: {
      type: 'sourates',
      goal: { sourateNumeros: [1, 2] },
      durationDays: 7,
      title: 'Défi test',
      inviteeIds: invitees.map((i) => i.userId),
      ...overrides,
    },
  });
}

d('challenges : aperçu, création, lecture (ticket 3.B3)', () => {
  let app: FastifyInstance;
  beforeAll(async () => { app = await makeApp(); });
  afterAll(async () => { await app.close(); });
  beforeEach(async () => { await resetDb(); });

  it('POST /me/challenges/preview : valide SANS créer, alreadyMasteredBy, dates calculées', async () => {
    const me = await makeUser(app, { timezone: 'Africa/Dakar' });
    const friend = await makeUser(app);
    await befriend(me.userId, friend.userId);
    learned.mockImplementation((userId) =>
      userId === friend.userId ? Promise.resolve([{ numero: 5 }] as unknown as LearnedSourate[]) : Promise.resolve([]),
    );

    const res = await app.inject({
      method: 'POST',
      url: '/me/challenges/preview',
      headers: authHeader(me.accessToken),
      payload: { type: 'sourates', goal: { sourateNumeros: [1, 2, 5] }, inviteeIds: [friend.userId] },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.valid).toBe(true);
    expect(body.errors).toEqual([]);
    expect(body.alreadyMasteredBy).toEqual({ [friend.userId]: [5] });
    expect(body.normalizedGoal).toEqual({ type: 'sourates', sourateNumeros: [1, 2, 5] });
    expect(body.computed.durationDays).toBe(7); // défaut de l'aperçu
    expect(body.computed.startDay).toBe(tomorrowKey());
    expect(body.computed.endDay).toBe(addCalendarDays(body.computed.startDay, 6)); // 7 jours -> +6
    expect(body.computed.startsAt).toBe(`${body.computed.startDay}T00:00:00.000Z`);
    expect(body.computed.endsAt).toBe(`${body.computed.endDay}T23:59:59.999Z`);

    // l'aperçu n'écrit rien en base
    expect(await prisma.challenge.count()).toBe(0);
  });

  it("POST /me/challenges/preview : refuse un non-ami et n'écrit rien", async () => {
    const me = await makeUser(app);
    const stranger = await registerUser(app);
    const res = await app.inject({
      method: 'POST',
      url: '/me/challenges/preview',
      headers: authHeader(me.accessToken),
      payload: { type: 'streak', goal: { days: 5 }, inviteeIds: [stranger.userId] },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.valid).toBe(false);
    expect(body.errors.length).toBeGreaterThan(0);
    expect(await prisma.challenge.count()).toBe(0);
  });

  it('POST /me/challenges : crée un défi, créateur "accepted", invités "invited"', async () => {
    const me = await makeUser(app, { timezone: 'Africa/Dakar' });
    const friend = await makeUser(app);
    await befriend(me.userId, friend.userId);
    learned.mockImplementation(() => Promise.resolve([]));

    const res = await createChallenge(app, me, [friend]);
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.status).toBe('pending');
    expect(body.participants).toBe(2);
    expect(body.startDay).toBe(tomorrowKey());
    expect(body.endDay).toBe(addCalendarDays(body.startDay, 6));
    expect(body.startsAt).toBe(`${body.startDay}T00:00:00.000Z`);

    const challenge = await prisma.challenge.findUnique({
      where: { id: body.id },
      include: { participants: true },
    });
    expect(challenge).toBeTruthy();
    expect(challenge!.creatorId).toBe(me.userId);
    expect(challenge!.participants.find((p) => p.userId === me.userId)!.status).toBe('accepted');
    const invited = challenge!.participants.find((p) => p.userId === friend.userId);
    expect(invited!.status).toBe('invited');
    expect(invited!.respondedAt).toBeNull();
  });

  it('POST /me/challenges : durée très longue acceptée (aucun plafond)', async () => {
    const me = await makeUser(app, { timezone: 'America/New_York' });
    const friend = await makeUser(app);
    await befriend(me.userId, friend.userId);
    learned.mockImplementation(() => Promise.resolve([]));

    const res = await createChallenge(app, me, [friend], { durationDays: 1000 });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.endDay).toBe(addCalendarDays(body.startDay, 999));
  });

  it('POST /me/challenges : durationDays = 1 -> endDay === startDay', async () => {
    const me = await makeUser(app, { timezone: 'Africa/Dakar' });
    const friend = await makeUser(app);
    await befriend(me.userId, friend.userId);
    learned.mockImplementation(() => Promise.resolve([]));

    const res = await createChallenge(app, me, [friend], { durationDays: 1 });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.endDay).toBe(body.startDay);
  });

  it("POST /me/challenges : refuse un invité qui n'est pas un ami", async () => {
    const me = await makeUser(app);
    const stranger = await registerUser(app);
    const res = await createChallenge(app, me, [stranger]);
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('NOT_FRIENDS');
  });

  it('POST /me/challenges : refuse au-delà de 10 participants ; accepte exactement 10', async () => {
    const me = await makeUser(app, { premium: true }); // 10 amis nécessitent le premium (free = 9 max)
    const friends = await Promise.all(Array.from({ length: 10 }, () => makeUser(app)));
    await Promise.all(friends.map((f) => befriend(me.userId, f.userId)));

    const tooMany = await createChallenge(app, me, friends);
    expect(tooMany.statusCode).toBe(400);
    expect(tooMany.json().error.code).toBe('VALIDATION_ERROR');

    const boundary = await createChallenge(app, me, friends.slice(0, 9));
    expect(boundary.statusCode).toBe(201);
    expect(boundary.json().participants).toBe(10);
  });

  it('POST /me/challenges : au plus 5 défis ouverts par créateur', async () => {
    const me = await makeUser(app);
    const friend = await makeUser(app);
    await befriend(me.userId, friend.userId);
    learned.mockImplementation(() => Promise.resolve([]));

    for (let i = 0; i < 5; i++) {
      const r = await createChallenge(app, me, [friend]);
      expect(r.statusCode).toBe(201);
    }
    const res = await createChallenge(app, me, [friend]);
    expect(res.statusCode).toBe(429);
    expect(res.json().error.code).toBe('QUOTA_EXCEEDED');
  });

  it('GET /me/challenges?status= : filtre par statut', async () => {
    const me = await makeUser(app);
    const friend = await makeUser(app);
    await befriend(me.userId, friend.userId);
    learned.mockImplementation(() => Promise.resolve([]));

    const c1 = await createChallenge(app, me, [friend]);
    const c2 = await createChallenge(app, me, [friend]);
    await prisma.challenge.update({ where: { id: c2.json().id }, data: { status: 'completed' } });

    const all = await app.inject({ method: 'GET', url: '/me/challenges', headers: authHeader(me.accessToken) });
    expect(all.statusCode).toBe(200);
    expect(all.json().items).toHaveLength(2);

    const pending = await app.inject({ method: 'GET', url: '/me/challenges?status=pending', headers: authHeader(me.accessToken) });
    expect(pending.json().items).toHaveLength(1);
    expect(pending.json().items[0].id).toBe(c1.json().id);

    const completed = await app.inject({ method: 'GET', url: '/me/challenges?status=completed', headers: authHeader(me.accessToken) });
    expect(completed.json().items).toHaveLength(1);
    expect(completed.json().items[0].id).toBe(c2.json().id);
  });

  it('GET /me/challenges/:id : détail + classement en direct ; 404 si non-participant', async () => {
    const me = await makeUser(app);
    const friend = await makeUser(app);
    const stranger = await registerUser(app);
    await befriend(me.userId, friend.userId);
    learned.mockImplementation((userId) => {
      if (userId === friend.userId) return Promise.resolve([{ numero: 1 }, { numero: 2 }] as unknown as LearnedSourate[]);
      if (userId === me.userId) return Promise.resolve([{ numero: 1 }] as unknown as LearnedSourate[]);
      return Promise.resolve([]);
    });

    const created = await createChallenge(app, me, [friend]);
    const id = created.json().id;

    const res = await app.inject({ method: 'GET', url: `/me/challenges/${id}`, headers: authHeader(me.accessToken) });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.id).toBe(id);
    expect(body.type).toBe('sourates');
    expect(body.status).toBe('pending');
    expect(body.participants).toHaveLength(2);

    // classement en direct par progression (friend = 2/2 premier, me = 1/2 second)
    const participants = body.participants as any[];
    const mePart = participants.find((p: any) => p.userId === me.userId);
    const frPart = participants.find((p: any) => p.userId === friend.userId);
    expect(frPart.rank).toBe(1);
    expect(frPart.progress).toBe(2);
    expect(frPart.target).toBe(2);
    expect(frPart.reached).toBe(true);
    expect(frPart.reachedAt).toBeNull();
    expect(frPart.status).toBe('invited');
    expect(frPart.user).toMatchObject({
      id: friend.userId,
      streak: expect.any(Number),
      learnedSouratesCount: 2,
      leagueTier: expect.any(String),
      weeklyXp: expect.any(Number),
    });
    expect(mePart.rank).toBe(2);
    expect(mePart.progress).toBe(1);
    expect(mePart.target).toBe(2);
    expect(mePart.reached).toBe(false);
    expect(mePart.status).toBe('accepted');

    // 404 : quelqu'un qui ne participe pas
    const asStranger = await app.inject({ method: 'GET', url: `/me/challenges/${id}`, headers: authHeader(stranger.accessToken) });
    expect(asStranger.statusCode).toBe(404);
    expect(asStranger.json().error.code).toBe('NOT_FOUND');

    // 404 : défi inexistant
    const unknown = await app.inject({
      method: 'GET',
      url: '/me/challenges/00000000-0000-0000-0000-000000000000',
      headers: authHeader(me.accessToken),
    });
    expect(unknown.statusCode).toBe(404);
  });
});

d('challenges : fin, rangs, récompenses (ticket 3.B7)', () => {
  let app: FastifyInstance;
  beforeAll(async () => { app = await makeApp(); });
  afterAll(async () => { await app.close(); });
  beforeEach(async () => { await resetDb(); });

  /** Amitié acceptée avec une date d'acceptation contrôlée. */
  async function befriendAt(aId: string, bId: string, acceptedAt: Date) {
    const low = aId < bId ? aId : bId;
    const high = aId < bId ? bId : aId;
    await prisma.friendship.create({
      data: {
        userLowId: low,
        userHighId: high,
        requestedById: aId,
        status: 'accepted',
        source: 'qr',
        createdAt: acceptedAt,
        acceptedAt,
      },
    });
  }

  /** Crée un défi "active" avec 2 participants "accepted" qui ont déjà atteint. */
  async function makeReachedChallenge(
    me: { userId: string },
    friend: { userId: string },
    opts: { startDaysAgo?: number; endDaysFromNow?: number } = {},
  ) {
    const now = new Date();
    const startDay = new Date(
      now.getTime() - (opts.startDaysAgo ?? 2) * 24 * 60 * 60 * 1000,
    ).toISOString().slice(0, 10);
    const endDay = new Date(
      now.getTime() + (opts.endDaysFromNow ?? 5) * 24 * 60 * 60 * 1000,
    ).toISOString().slice(0, 10);

    const challenge = await prisma.challenge.create({
      data: {
        creatorId: me.userId,
        type: 'sourates',
        title: 'Défi test',
        goal: { sourateNumeros: [1] },
        timezone: 'UTC',
        startDay,
        endDay,
        startsAt: new Date(`${startDay}T00:00:00.000Z`),
        endsAt: new Date(`${endDay}T23:59:59.999Z`),
        status: 'active',
        winnerIds: [],
      },
    });

    await prisma.challengeParticipant.create({
      data: {
        challengeId: challenge.id,
        userId: me.userId,
        status: 'accepted',
        baseline: 0,
        progress: 1,
        target: 1,
        reachedAt: now,
      },
    });
    await prisma.challengeParticipant.create({
      data: {
        challengeId: challenge.id,
        userId: friend.userId,
        status: 'accepted',
        baseline: 0,
        progress: 1,
        target: 1,
        reachedAt: now,
      },
    });

    return challenge;
  }

  it('deux participants finissent en même temps => un gagnant, pas de double paiement', async () => {
    const me = await makeUser(app);
    const friend = await makeUser(app);
    await befriendAt(me.userId, friend.userId, new Date(Date.now() - 48 * 60 * 60 * 1000));

    const challenge = await makeReachedChallenge(me, friend);

    const r1 = await finishChallenge({ tx: prisma, challengeId: challenge.id, now: new Date() });
    expect(r1.finished).toBe(true);

    const updated = await prisma.challenge.findUnique({ where: { id: challenge.id } });
    expect(updated!.status).toBe('completed');
    expect(updated!.winnerIds.length).toBeGreaterThan(0);

    // Un seul paiement par participant
    const gems = await prisma.gemTransaction.findMany({
      where: { ref: challenge.id },
    });
    const winnerGem = gems.find((g) => g.amount === 50);
    const loserGem = gems.find((g) => g.amount === 20);
    expect(winnerGem).toBeTruthy();
    expect(loserGem).toBeTruthy();
    expect(gems.length).toBe(2);

    // Idempotence : relancer, pas de nouveau paiement
    const r2 = await finishChallenge({ tx: prisma, challengeId: challenge.id, now: new Date() });
    expect(r2.finished).toBe(false);

    const gems2 = await prisma.gemTransaction.findMany({
      where: { ref: challenge.id },
    });
    expect(gems2.length).toBe(2);
  });

  it('règle D-G : amitié < 24 h => aucune gemme', async () => {
    const me = await makeUser(app);
    const friend = await makeUser(app);
    await befriendAt(me.userId, friend.userId, new Date(Date.now() - 60 * 60 * 1000)); // il y a 1h

    const challenge = await makeReachedChallenge(me, friend);

    const result = await finishChallenge({ tx: prisma, challengeId: challenge.id, now: new Date() });
    expect(result.finished).toBe(true);

    const gems = await prisma.gemTransaction.findMany({
      where: { ref: challenge.id },
    });
    expect(gems.length).toBe(0);
  });

  it('règle D-G : amitié >= 24 h => gemmes versées', async () => {
    const me = await makeUser(app);
    const friend = await makeUser(app);
    await befriendAt(me.userId, friend.userId, new Date(Date.now() - 48 * 60 * 60 * 1000)); // il y a 48h

    const challenge = await makeReachedChallenge(me, friend);

    const result = await finishChallenge({ tx: prisma, challengeId: challenge.id, now: new Date() });
    expect(result.finished).toBe(true);

    const gems = await prisma.gemTransaction.findMany({
      where: { ref: challenge.id },
    });
    expect(gems.length).toBe(2);
  });

  it('moins de 2 acceptés => pas de fin, pas de récompense', async () => {
    const me = await makeUser(app);
    const friend = await makeUser(app);
    await befriendAt(me.userId, friend.userId, new Date(Date.now() - 48 * 60 * 60 * 1000));

    const now = new Date();
    const startDay = new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const endDay = new Date(now.getTime() + 5 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

    const challenge = await prisma.challenge.create({
      data: {
        creatorId: me.userId,
        type: 'sourates',
        title: 'Défi solo',
        goal: { sourateNumeros: [1] },
        timezone: 'UTC',
        startDay,
        endDay,
        startsAt: new Date(`${startDay}T00:00:00.000Z`),
        endsAt: new Date(`${endDay}T23:59:59.999Z`),
        status: 'active',
        winnerIds: [],
      },
    });

    await prisma.challengeParticipant.create({
      data: {
        challengeId: challenge.id,
        userId: me.userId,
        status: 'accepted',
        baseline: 0,
        progress: 1,
        target: 1,
        reachedAt: now,
      },
    });

    const result = await finishChallenge({ tx: prisma, challengeId: challenge.id, now: new Date() });
    expect(result.finished).toBe(false);

    const updated = await prisma.challenge.findUnique({ where: { id: challenge.id } });
    expect(updated!.status).toBe('active');

    const gems = await prisma.gemTransaction.findMany({
      where: { ref: challenge.id },
    });
    expect(gems.length).toBe(0);
  });

  it('durée < 3 jours => défi terminé mais aucune récompense', async () => {
    const me = await makeUser(app);
    const friend = await makeUser(app);
    await befriendAt(me.userId, friend.userId, new Date(Date.now() - 48 * 60 * 60 * 1000));

    const now = new Date();
    const startDay = new Date(now.getTime() - 1 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10); // 1 jour
    const endDay = new Date(now.getTime()).toISOString().slice(0, 10);

    const challenge = await prisma.challenge.create({
      data: {
        creatorId: me.userId,
        type: 'sourates',
        title: 'Défi court',
        goal: { sourateNumeros: [1] },
        timezone: 'UTC',
        startDay,
        endDay,
        startsAt: new Date(`${startDay}T00:00:00.000Z`),
        endsAt: new Date(`${endDay}T23:59:59.999Z`),
        status: 'active',
        winnerIds: [],
      },
    });

    await prisma.challengeParticipant.create({
      data: { challengeId: challenge.id, userId: me.userId, status: 'accepted', baseline: 0, progress: 1, target: 1, reachedAt: now },
    });
    await prisma.challengeParticipant.create({
      data: { challengeId: challenge.id, userId: friend.userId, status: 'accepted', baseline: 0, progress: 1, target: 1, reachedAt: now },
    });

    const result = await finishChallenge({ tx: prisma, challengeId: challenge.id, now: new Date() });
    expect(result.finished).toBe(true);

    const gems = await prisma.gemTransaction.findMany({
      where: { ref: challenge.id },
    });
    expect(gems.length).toBe(0);
  });
});

d('challenges : fin à l\'échéance, fin paresseuse, relance (ticket 3.B8)', () => {
  let app: FastifyInstance;
  beforeAll(async () => { app = await makeApp(); });
  afterAll(async () => { await app.close(); });
  beforeEach(async () => { await resetDb(); });

  async function befriendAt(aId: string, bId: string, acceptedAt: Date) {
    const low = aId < bId ? aId : bId;
    const high = aId < bId ? bId : aId;
    await prisma.friendship.create({
      data: {
        userLowId: low,
        userHighId: high,
        requestedById: aId,
        status: 'accepted',
        source: 'qr',
        createdAt: acceptedAt,
        acceptedAt,
      },
    });
  }

  async function makeActiveExpiredChallenge(
    me: { userId: string },
    friend: { userId: string },
  ) {
    const now = new Date();
    const startDay = new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const endDay = new Date(now.getTime() - 1 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10); // déjà échu

    const challenge = await prisma.challenge.create({
      data: {
        creatorId: me.userId,
        type: 'sourates',
        title: 'Défi expiré',
        goal: { sourateNumeros: [1] },
        timezone: 'UTC',
        startDay,
        endDay,
        startsAt: new Date(`${startDay}T00:00:00.000Z`),
        endsAt: new Date(`${endDay}T23:59:59.999Z`),
        status: 'active',
        winnerIds: [],
      },
    });

    await prisma.challengeParticipant.create({
      data: {
        challengeId: challenge.id,
        userId: me.userId,
        status: 'accepted',
        baseline: 0,
        progress: 0,
        target: 1,
      },
    });
    await prisma.challengeParticipant.create({
      data: {
        challengeId: challenge.id,
        userId: friend.userId,
        status: 'accepted',
        baseline: 0,
        progress: 0,
        target: 1,
      },
    });

    return challenge;
  }

  async function nudge(app: FastifyInstance, token: string, id: string, userId: string) {
    return app.inject({
      method: 'POST',
      url: `/me/challenges/${id}/nudge`,
      headers: authHeader(token),
      payload: { userId },
    });
  }

  it('job finalizeChallenges : termine un défi active dont endsAt est passé', async () => {
    const me = await makeUser(app);
    const friend = await makeUser(app);
    await befriendAt(me.userId, friend.userId, new Date(Date.now() - 48 * 60 * 60 * 1000));

    const challenge = await makeActiveExpiredChallenge(me, friend);

    const result = await finalizeChallenges(new Date());
    expect(result!.finalized).toBe(1);

    const updated = await prisma.challenge.findUnique({ where: { id: challenge.id } });
    expect(updated!.status).toBe('completed');
    expect(updated!.finishedAt).not.toBeNull();
  });

  it('job finalizeChallenges : idempotent, relance sans effet', async () => {
    const me = await makeUser(app);
    const friend = await makeUser(app);
    await befriendAt(me.userId, friend.userId, new Date(Date.now() - 48 * 60 * 60 * 1000));

    const challenge = await makeActiveExpiredChallenge(me, friend);

    const r1 = await finalizeChallenges(new Date());
    expect(r1!.finalized).toBe(1);

    const r2 = await finalizeChallenges(new Date());
    expect(r2!.finalized).toBe(0);

    const updated = await prisma.challenge.findUnique({ where: { id: challenge.id } });
    expect(updated!.status).toBe('completed');
  });

  it('GET /me/challenges : termine un défi échu avant de répondre (fin paresseuse)', async () => {
    const me = await makeUser(app);
    const friend = await makeUser(app);
    await befriendAt(me.userId, friend.userId, new Date(Date.now() - 48 * 60 * 60 * 1000));

    const challenge = await makeActiveExpiredChallenge(me, friend);

    const res = await app.inject({
      method: 'GET',
      url: '/me/challenges',
      headers: authHeader(me.accessToken),
    });
    expect(res.statusCode).toBe(200);

    const updated = await prisma.challenge.findUnique({ where: { id: challenge.id } });
    expect(updated!.status).toBe('completed');
  });

  it('GET /me/challenges/:id : termine un défi échu avant de répondre (fin paresseuse)', async () => {
    const me = await makeUser(app);
    const friend = await makeUser(app);
    await befriendAt(me.userId, friend.userId, new Date(Date.now() - 48 * 60 * 60 * 1000));

    const challenge = await makeActiveExpiredChallenge(me, friend);

    const res = await app.inject({
      method: 'GET',
      url: `/me/challenges/${challenge.id}`,
      headers: authHeader(me.accessToken),
    });
    expect(res.statusCode).toBe(200);

    const updated = await prisma.challenge.findUnique({ where: { id: challenge.id } });
    expect(updated!.status).toBe('completed');
  });

  it('POST /me/challenges/:id/nudge : premier nudge => 200, lastNudgedAt enregistré', async () => {
    const me = await makeUser(app);
    const friend = await makeUser(app);
    await befriendAt(me.userId, friend.userId, new Date(Date.now() - 48 * 60 * 60 * 1000));

    const challenge = await makeActiveExpiredChallenge(me, friend);

    const res = await nudge(app, me.accessToken, challenge.id, friend.userId);
    expect(res.statusCode).toBe(200);
    expect(res.json().nudged).toBe(true);

    const participant = await prisma.challengeParticipant.findUnique({
      where: { challengeId: challenge.id, userId: friend.userId },
    });
    expect(participant!.lastNudgedAt).not.toBeNull();
  });

  it('POST /me/challenges/:id/nudge : 2e nudge dans les 24 h => QUOTA_EXCEEDED', async () => {
    const me = await makeUser(app);
    const friend = await makeUser(app);
    await befriendAt(me.userId, friend.userId, new Date(Date.now() - 48 * 60 * 60 * 1000));

    const challenge = await makeActiveExpiredChallenge(me, friend);

    const r1 = await nudge(app, me.accessToken, challenge.id, friend.userId);
    expect(r1.statusCode).toBe(200);

    const r2 = await nudge(app, me.accessToken, challenge.id, friend.userId);
    expect(r2.statusCode).toBe(429);
    expect(r2.json().error.code).toBe('QUOTA_EXCEEDED');
  });

  it('POST /me/challenges/:id/nudge : nudge après 24 h => accepté', async () => {
    const me = await makeUser(app);
    const friend = await makeUser(app);
    await befriendAt(me.userId, friend.userId, new Date(Date.now() - 48 * 60 * 60 * 1000));

    const challenge = await makeActiveExpiredChallenge(me, friend);

    const r1 = await nudge(app, me.accessToken, challenge.id, friend.userId);
    expect(r1.statusCode).toBe(200);

    // Simuler le passage de 24h en mettant à jour lastNudgedAt dans le passé
    await prisma.challengeParticipant.update({
      where: { challengeId: challenge.id, userId: friend.userId },
      data: { lastNudgedAt: new Date(Date.now() - 25 * 60 * 60 * 1000) },
    });

    const r2 = await nudge(app, me.accessToken, challenge.id, friend.userId);
    expect(r2.statusCode).toBe(200);
  });
});

d('challenges : scénarios complets (ticket 3.B9)', () => {
  let app: FastifyInstance;
  beforeAll(async () => { app = await makeApp(); });
  afterAll(async () => { await app.close(); });
  beforeEach(async () => { await resetDb(); });

  /** Amitié acceptée (modèle Friendship : userLowId / userHighId). */
  async function befriend(aId: string, bId: string) {
    const low = aId < bId ? aId : bId;
    const high = aId < bId ? bId : aId;
    await prisma.friendship.create({
      data: { userLowId: low, userHighId: high, requestedById: aId, status: 'accepted', source: 'qr', createdAt: new Date(), acceptedAt: new Date() },
    });
  }

  /** Crée un défi actif avec 3 participants "accepted" qui ont atteint leur cible. */
  async function makeReachedChallenge3(
    a: { userId: string },
    b: { userId: string },
    c: { userId: string },
    opts: { type: 'streak' | 'sourates'; startDaysAgo?: number; durationDays?: number } = { type: 'sourates', startDaysAgo: 2, durationDays: 7 },
  ) {
    const now = new Date();
    const startDay = new Date(now.getTime() - (opts.startDaysAgo ?? 2) * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const endDay = new Date(now.getTime() + ((opts.durationDays ?? 7) - 1) * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

    const challenge = await prisma.challenge.create({
      data: {
        creatorId: a.userId,
        type: opts.type,
        title: 'Défi test 3 amis',
        goal: opts.type === 'sourates' ? { sourateNumeros: [108, 109, 110] } : { days: 3 },
        timezone: 'UTC',
        startDay,
        endDay,
        startsAt: new Date(`${startDay}T00:00:00.000Z`),
        endsAt: new Date(`${endDay}T23:59:59.999Z`),
        status: 'active',
        winnerIds: [],
      },
    });

    // Tous les 3 ont atteint leur cible
    const baseProgress = opts.type === 'sourates' ? 3 : 3;
    const baseReached = now;
    for (const u of [a, b, c]) {
      await prisma.challengeParticipant.create({
        data: {
          challengeId: challenge.id,
          userId: u.userId,
          status: 'accepted',
          baseline: 0,
          progress: baseProgress,
          target: baseProgress,
          reachedAt: baseReached,
        },
      });
    }

    return challenge;
  }

  it('3 amis, sourates 108/109/110 : A gagne, B et C complètent', async () => {
    const a = await makeUser(app, { timezone: 'Africa/Dakar' });
    const b = await makeUser(app, { timezone: 'Africa/Dakar' });
    const c = await makeUser(app, { timezone: 'Africa/Dakar' });
    await befriend(a.userId, b.userId);
    await befriend(a.userId, c.userId);
    await befriend(b.userId, c.userId);

    const challenge = await makeReachedChallenge3(a, b, c, { type: 'sourates', startDaysAgo: 2, durationDays: 7 });

    // A a terminé en premier (reachedAt le plus tôt)
    await prisma.challengeParticipant.update({
      where: { challengeId: challenge.id, userId: a.userId },
      data: { reachedAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000) },
    });
    // B a terminé 2e
    await prisma.challengeParticipant.update({
      where: { challengeId: challenge.id, userId: b.userId },
      data: { reachedAt: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000) },
    });
    // C a terminé 3e (maintenant)
    await prisma.challengeParticipant.update({
      where: { challengeId: challenge.id, userId: c.userId },
      data: { reachedAt: new Date() },
    });

    const result = await finishChallenge({ tx: prisma, challengeId: challenge.id, now: new Date() });
    expect(result.finished).toBe(true);

    const updated = await prisma.challenge.findUnique({ where: { id: challenge.id } });
    expect(updated!.status).toBe('completed');
    expect(updated!.winnerIds).toContain(a.userId);
    expect(updated!.winnerIds.length).toBe(1);

    // Vérifier les gemmes : A=50 (win), B=20 (complete), C=20 (complete)
    const gems = await prisma.gemTransaction.findMany({
      where: { ref: challenge.id },
    });
    expect(gems.length).toBe(3);

    const aGem = gems.find((g) => g.userId === a.userId);
    const bGem = gems.find((g) => g.userId === b.userId);
    const cGem = gems.find((g) => g.userId === c.userId);
    expect(aGem!.amount).toBe(50);
    expect(aGem!.reason).toBe('challenge_win');
    expect(bGem!.amount).toBe(20);
    expect(bGem!.reason).toBe('challenge_complete');
    expect(cGem!.amount).toBe(20);
    expect(cGem!.reason).toBe('challenge_complete');

    // Vérifier les rangs
    const participants = await prisma.challengeParticipant.findMany({
      where: { challengeId: challenge.id },
    });
    const aPart = participants.find((p) => p.userId === a.userId);
    const bPart = participants.find((p) => p.userId === b.userId);
    const cPart = participants.find((p) => p.userId === c.userId);
    expect(aPart!.rank).toBe(1);
    expect(bPart!.rank).toBe(2);
    expect(cPart!.rank).toBe(3);
  });

  it('Streak de 3 jours : Dakar / Paris / Auckland', async () => {
    const a = await makeUser(app, { timezone: 'Africa/Dakar' });
    const b = await makeUser(app, { timezone: 'Europe/Paris' });
    const c = await makeUser(app, { timezone: 'Pacific/Auckland' });
    await befriend(a.userId, b.userId);
    await befriend(a.userId, c.userId);
    await befriend(b.userId, c.userId);

    const now = new Date();
    const startDay = new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const endDay = new Date(now.getTime()).toISOString().slice(0, 10);

    const challenge = await prisma.challenge.create({
      data: {
        creatorId: a.userId,
        type: 'streak',
        title: 'Défi streak 3 jours',
        goal: { days: 3 },
        timezone: 'UTC',
        startDay,
        endDay,
        startsAt: new Date(`${startDay}T00:00:00.000Z`),
        endsAt: new Date(`${endDay}T23:59:59.999Z`),
        status: 'active',
        winnerIds: [],
      },
    });

    // Chaque utilisateur a 3 jours d'activité consécutifs dans son fuseau
    for (const u of [a, b, c]) {
      for (let i = 0; i < 3; i++) {
        const day = new Date(now.getTime() - (2 - i) * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
        await prisma.activityDay.create({
          data: { userId: u.userId, day },
        });
      }
      await prisma.challengeParticipant.create({
        data: {
          challengeId: challenge.id,
          userId: u.userId,
          status: 'accepted',
          baseline: 0,
          progress: 3,
          target: 3,
          reachedAt: now,
        },
      });
    }

    const result = await finishChallenge({ tx: prisma, challengeId: challenge.id, now: new Date() });
    expect(result.finished).toBe(true);

    const updated = await prisma.challenge.findUnique({ where: { id: challenge.id } });
    expect(updated!.status).toBe('completed');
    expect(updated!.winnerIds.length).toBeGreaterThan(0);

    // Tous les 3 ont reçu des gemmes (win ou complete)
    const gems = await prisma.gemTransaction.findMany({
      where: { ref: challenge.id },
    });
    expect(gems.length).toBe(3);

    const winnerGem = gems.find((g) => g.amount === 50);
    const completeGems = gems.filter((g) => g.amount === 20);
    expect(winnerGem).toBeTruthy();
    expect(completeGems.length).toBe(2);
  });
});

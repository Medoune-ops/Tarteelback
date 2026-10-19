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
import { activateChallenges } from '../src/jobs/maintenance.js';

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

async function accept(app: FastifyInstance, token: string, id: string) {
  return app.inject({
    method: 'POST',
    url: `/me/challenges/${id}/accept`,
    headers: authHeader(token),
  });
}
async function decline(app: FastifyInstance, token: string, id: string) {
  return app.inject({
    method: 'POST',
    url: `/me/challenges/${id}/decline`,
    headers: authHeader(token),
  });
}
async function leave(app: FastifyInstance, token: string, id: string) {
  return app.inject({
    method: 'POST',
    url: `/me/challenges/${id}/leave`,
    headers: authHeader(token),
  });
}
async function cancel(app: FastifyInstance, token: string, id: string) {
  return app.inject({
    method: 'POST',
    url: `/me/challenges/${id}/cancel`,
    headers: authHeader(token),
  });
}

d('challenges : accepter / refuser / quitter / annuler (ticket 3.B4)', () => {
  let app: FastifyInstance;
  beforeAll(async () => { app = await makeApp(); });
  afterAll(async () => { await app.close(); });
  beforeEach(async () => { await resetDb(); });

  it('POST /me/challenges/:id/accept : invité accepte, passe "accepted"', async () => {
    const me = await makeUser(app, { timezone: 'Africa/Dakar' });
    const friend = await makeUser(app);
    await befriend(me.userId, friend.userId);
    learned.mockImplementation(() => Promise.resolve([]));

    const created = await createChallenge(app, me, [friend]);
    const id = created.json().id;

    const res = await accept(app, friend.accessToken, id);
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe('accepted');

    const challenge = await prisma.challenge.findUnique({
      where: { id },
      include: { participants: true },
    });
    const part = challenge!.participants.find((p) => p.userId === friend.userId);
    expect(part!.status).toBe('accepted');
    expect(part!.respondedAt).not.toBeNull();
  });

  it('POST /me/challenges/:id/accept : après le début => CHALLENGE_CLOSED', async () => {
    const me = await makeUser(app, { timezone: 'Africa/Dakar' });
    const friend = await makeUser(app);
    await befriend(me.userId, friend.userId);
    learned.mockImplementation(() => Promise.resolve([]));

    const created = await createChallenge(app, me, [friend]);
    const id = created.json().id;

    await prisma.challenge.update({
      where: { id },
      data: { startsAt: new Date(Date.now() - 60_000) },
    });

    const res = await accept(app, friend.accessToken, id);
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('CHALLENGE_CLOSED');
  });

  it('POST /me/challenges/:id/decline : invité décline, passe "declined"', async () => {
    const me = await makeUser(app);
    const friend = await makeUser(app);
    await befriend(me.userId, friend.userId);
    learned.mockImplementation(() => Promise.resolve([]));

    const created = await createChallenge(app, me, [friend]);
    const id = created.json().id;

    const res = await decline(app, friend.accessToken, id);
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe('declined');

    const challenge = await prisma.challenge.findUnique({
      where: { id },
      include: { participants: true },
    });
    const part = challenge!.participants.find((p) => p.userId === friend.userId);
    expect(part!.status).toBe('declined');
    expect(part!.respondedAt).not.toBeNull();
  });

  it('POST /me/challenges/:id/leave : participant quitte, passe "left"', async () => {
    const me = await makeUser(app);
    const friend = await makeUser(app);
    await befriend(me.userId, friend.userId);
    learned.mockImplementation(() => Promise.resolve([]));

    const created = await createChallenge(app, me, [friend]);
    const id = created.json().id;

    const res = await leave(app, me.accessToken, id);
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe('left');

    const challenge = await prisma.challenge.findUnique({
      where: { id },
      include: { participants: true },
    });
    const part = challenge!.participants.find((p) => p.userId === me.userId);
    expect(part!.status).toBe('left');
  });

  it('POST /me/challenges/:id/cancel : créateur annule avant le début', async () => {
    const me = await makeUser(app);
    const friend = await makeUser(app);
    await befriend(me.userId, friend.userId);
    learned.mockImplementation(() => Promise.resolve([]));

    const created = await createChallenge(app, me, [friend]);
    const id = created.json().id;

    const res = await cancel(app, me.accessToken, id);
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe('cancelled');

    const challenge = await prisma.challenge.findUnique({ where: { id } });
    expect(challenge!.status).toBe('cancelled');
  });

  it('POST /me/challenges/:id/cancel : non-créateur reçoit 403', async () => {
    const me = await makeUser(app);
    const friend = await makeUser(app);
    await befriend(me.userId, friend.userId);
    learned.mockImplementation(() => Promise.resolve([]));

    const created = await createChallenge(app, me, [friend]);
    const id = created.json().id;

    const res = await cancel(app, friend.accessToken, id);
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('FORBIDDEN');
  });

  it('POST /me/challenges/:id/cancel : après le début => CHALLENGE_CLOSED', async () => {
    const me = await makeUser(app);
    const friend = await makeUser(app);
    await befriend(me.userId, friend.userId);
    learned.mockImplementation(() => Promise.resolve([]));

    const created = await createChallenge(app, me, [friend]);
    const id = created.json().id;

    await prisma.challenge.update({
      where: { id },
      data: { startsAt: new Date(Date.now() - 60_000) },
    });

    const res = await cancel(app, me.accessToken, id);
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('CHALLENGE_CLOSED');
  });

  it('POST /me/challenges/:id/* : non-participant reçoit 404', async () => {
    const me = await makeUser(app);
    const friend = await makeUser(app);
    const stranger = await registerUser(app);
    await befriend(me.userId, friend.userId);
    learned.mockImplementation(() => Promise.resolve([]));

    const created = await createChallenge(app, me, [friend]);
    const id = created.json().id;

    for (const method of ['accept', 'decline', 'leave', 'cancel'] as const) {
      const res = await app.inject({
        method: 'POST',
        url: `/me/challenges/${id}/${method}`,
        headers: authHeader(stranger.accessToken),
      });
      expect(res.statusCode).toBe(404);
      expect(res.json().error.code).toBe('NOT_FOUND');
    }
  });
});

d('challenges : job activateChallenges (ticket 3.B5)', () => {
  let app: FastifyInstance;
  beforeAll(async () => { app = await makeApp(); });
  afterAll(async () => { await app.close(); });
  beforeEach(async () => { await resetDb(); });

  it('>= 2 acceptés : passe "active", baseline enregistrée, invited → expired', async () => {
    const me = await makeUser(app, { timezone: 'Africa/Dakar' });
    const f1 = await makeUser(app);
    const f2 = await makeUser(app);
    await befriend(me.userId, f1.userId);
    await befriend(me.userId, f2.userId);
    learned.mockImplementation(() => Promise.resolve([]));

    const created = await createChallenge(app, me, [f1, f2]);
    const id = created.json().id;

    await accept(app, f1.accessToken, id);
    await accept(app, f2.accessToken, id);

    await prisma.challenge.update({
      where: { id },
      data: { startsAt: new Date(Date.now() - 60_000) },
    });

    const result = await activateChallenges(new Date());
    expect(result!.activated).toBe(1);
    expect(result!.cancelled).toBe(0);

    const challenge = await prisma.challenge.findUnique({
      where: { id },
      include: { participants: true },
    });
    expect(challenge!.status).toBe('active');

    for (const p of challenge!.participants) {
      expect(p.baseline).toBeGreaterThanOrEqual(0);
    }

    const invited = challenge!.participants.filter((p) => p.status === 'invited');
    expect(invited).toHaveLength(0);
  });

  it('< 2 acceptés : passe "cancelled"', async () => {
    const me = await makeUser(app);
    const f1 = await makeUser(app);
    await befriend(me.userId, f1.userId);
    learned.mockImplementation(() => Promise.resolve([]));

    const created = await createChallenge(app, me, [f1]);
    const id = created.json().id;

    await prisma.challenge.update({
      where: { id },
      data: { startsAt: new Date(Date.now() - 60_000) },
    });

    const result = await activateChallenges(new Date());
    expect(result!.activated).toBe(0);
    expect(result!.cancelled).toBe(1);

    const challenge = await prisma.challenge.findUnique({ where: { id } });
    expect(challenge!.status).toBe('cancelled');
  });

  it('le job est relançable sans effet (idempotent)', async () => {
    const me = await makeUser(app);
    const f1 = await makeUser(app);
    await befriend(me.userId, f1.userId);
    learned.mockImplementation(() => Promise.resolve([]));

    const created = await createChallenge(app, me, [f1]);
    const id = created.json().id;

    await prisma.challenge.update({
      where: { id },
      data: { startsAt: new Date(Date.now() - 60_000) },
    });

    const r1 = await activateChallenges(new Date());
    expect(r1!.cancelled).toBe(1);

    const r2 = await activateChallenges(new Date());
    expect(r2!.cancelled).toBe(0);
    expect(r2!.activated).toBe(0);

    const challenge = await prisma.challenge.findUnique({ where: { id } });
    expect(challenge!.status).toBe('cancelled');
  });
});

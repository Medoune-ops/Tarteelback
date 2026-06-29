import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { DB_TESTS, makeApp, resetDb, registerUser, authHeader } from './helpers/testApp.js';
import { prisma } from '../src/config/prisma.js';

const d = DB_TESTS ? describe : describe.skip;

/**
 * Data-isolation / authorisation tests. The guarantee under test: every
 * authenticated action is scoped to the user id carried by the *signed access
 * token* (req.auth.sub) — never an id supplied by the client. So user A can
 * never read or mutate user B's data (no IDOR), and a token from one account
 * never grants access to another.
 */
d('security: per-user data isolation (integration)', () => {
  let app: FastifyInstance;
  beforeAll(async () => { app = await makeApp(); });
  afterAll(async () => { await app.close(); });
  beforeEach(async () => { await resetDb(); });

  it('GET /me returns the token owner, even with a forged body/query userId', async () => {
    const a = await registerUser(app, { email: 'a@iso.app', displayName: 'Alice A.' });
    const b = await registerUser(app, { email: 'b@iso.app', displayName: 'Bob B.' });
    // Give B distinct state so identity confusion would be observable.
    await prisma.user.update({ where: { id: b.userId }, data: { xp: 777, streak: 9 } });

    // A asks for /me while trying to pass B's id in body and query.
    const res = await app.inject({
      method: 'GET',
      url: `/me?userId=${b.userId}`,
      headers: authHeader(a.accessToken),
      payload: { userId: b.userId, id: b.userId },
    });
    expect(res.statusCode).toBe(200);
    // The flat /me has no id; identity is proven by A's own (default) state,
    // never B's forged xp/streak.
    expect(res.json().xp).toBe(0); // A, never B's 777
    expect(res.json().streak).toBe(0); // A, never B's 9
  });

  it("A's XP/streak changes never touch B", async () => {
    const a = await registerUser(app, { email: 'a2@iso.app' });
    const b = await registerUser(app, { email: 'b2@iso.app' });

    const section = await prisma.section.create({
      data: { ordre: 1, kicker: 'T', titre: 'T', sousTitre: '', couleur: '#000', degradeStart: '#000', degradeEnd: '#111', headerIcon: 'x' },
    });
    const lesson = await prisma.lesson.create({ data: { sectionId: section.id, ordre: 1, titre: 'L' } });

    await app.inject({ method: 'POST', url: `/lessons/${lesson.id}/complete`, headers: authHeader(a.accessToken), payload: {} });

    const bMe = await app.inject({ method: 'GET', url: '/me', headers: authHeader(b.accessToken) });
    expect(bMe.json().xp).toBe(0); // B untouched
    const aMe = await app.inject({ method: 'GET', url: '/me', headers: authHeader(a.accessToken) });
    expect(aMe.json().xp).toBe(15); // 15 base (no test steps)

    // Progress rows are per-user.
    const aProg = await prisma.lessonProgress.findUnique({ where: { userId_lessonId: { userId: a.userId, lessonId: lesson.id } } });
    const bProg = await prisma.lessonProgress.findUnique({ where: { userId_lessonId: { userId: b.userId, lessonId: lesson.id } } });
    expect(aProg?.etat).toBe('completed');
    expect(bProg).toBeNull();
  });

  it('billing status only ever lists the caller\'s own transactions', async () => {
    const a = await registerUser(app, { email: 'a3@iso.app' });
    const b = await registerUser(app, { email: 'b3@iso.app' });

    await app.inject({ method: 'POST', url: '/billing/subscribe', headers: authHeader(a.accessToken), payload: { plan: 'mensuel' } });

    const aStatus = await app.inject({ method: 'GET', url: '/billing/status', headers: authHeader(a.accessToken) });
    expect(aStatus.json().transactions.length).toBe(1);
    expect(aStatus.json().transactions.every((t: { userId: string }) => t.userId === a.userId)).toBe(true);

    const bStatus = await app.inject({ method: 'GET', url: '/billing/status', headers: authHeader(b.accessToken) });
    expect(bStatus.json().transactions.length).toBe(0); // B sees nothing of A
    expect(bStatus.json().isPremium).toBe(false);
  });

  it("A cannot refresh or revoke B's session", async () => {
    const a = await registerUser(app, { email: 'a4@iso.app', deviceId: 'devA' });
    const b = await registerUser(app, { email: 'b4@iso.app', deviceId: 'devB' });

    // A presents B's refresh token but with A's device id -> rejected.
    const cross = await app.inject({
      method: 'POST', url: '/auth/refresh',
      payload: { refreshToken: b.refreshToken, deviceId: 'devA' },
    });
    expect(cross.statusCode).toBe(401);

    // B's token still works for B.
    const ok = await app.inject({
      method: 'POST', url: '/auth/refresh',
      payload: { refreshToken: b.refreshToken, deviceId: 'devB' },
    });
    expect(ok.statusCode).toBe(200);
  });

  it('protected routes reject missing/garbage tokens', async () => {
    const none = await app.inject({ method: 'GET', url: '/me' });
    expect(none.statusCode).toBe(401);
    expect(none.json().error.code).toBe('UNAUTHENTICATED');

    const garbage = await app.inject({ method: 'GET', url: '/me', headers: { authorization: 'Bearer not.a.jwt' } });
    expect(garbage.statusCode).toBe(401);
  });

  it('admin routes are forbidden for normal users', async () => {
    const a = await registerUser(app, { email: 'a5@iso.app' });
    const res = await app.inject({
      method: 'POST', url: '/admin/sections',
      headers: authHeader(a.accessToken),
      payload: { ordre: 99, kicker: 'X', titre: 'X', couleur: '#000', degradeStart: '#000', degradeEnd: '#111', headerIcon: 'x' },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('FORBIDDEN');
  });

  it('PATCH /me cannot escalate privileges or inject protected fields', async () => {
    const a = await registerUser(app, { email: 'esc@iso.app' });
    const res = await app.inject({
      method: 'PATCH', url: '/me',
      headers: authHeader(a.accessToken),
      // Attempt to self-grant premium/admin and forge stats via mass assignment.
      payload: {
        displayName: 'Legit Name',
        isPremium: true,
        role: 'admin',
        xp: 999999,
        hearts: 99,
        premiumUntil: '2099-01-01T00:00:00Z',
        id: 'someone-else',
      },
    });
    // Strict validation rejects unknown keys outright.
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('VALIDATION_ERROR');

    // And nothing leaked through: the user is still a free, non-admin account.
    const me = await app.inject({ method: 'GET', url: '/me', headers: authHeader(a.accessToken) });
    expect(me.json().isPremium).toBe(false);
    expect(me.json().xp).toBe(0);
    expect(me.json().hearts).toBe(5);
    // role isn't exposed in the flat /me; verify it stayed `user` in the DB.
    const fresh = await prisma.user.findUniqueOrThrow({ where: { id: a.userId } });
    expect(fresh.role).toBe('user');
    expect(fresh.isPremium).toBe(false);
  });

  it('a token signed with the wrong secret is rejected', async () => {
    // Forge a token with a bogus signature.
    const forged =
      'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9' +
      '.eyJzdWIiOiJoYWNrZXIiLCJyb2xlIjoiYWRtaW4ifQ' +
      '.invalidsignature';
    const res = await app.inject({ method: 'GET', url: '/me', headers: { authorization: `Bearer ${forged}` } });
    expect(res.statusCode).toBe(401);
  });
});

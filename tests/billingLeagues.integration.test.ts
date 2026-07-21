import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { DB_TESTS, makeApp, resetDb, registerUser, authHeader } from './helpers/testApp.js';
import { prisma } from '../src/config/prisma.js';

const d = DB_TESTS ? describe : describe.skip;

d('billing & streak repair (integration)', () => {
  let app: FastifyInstance;
  beforeAll(async () => { app = await makeApp(); });
  afterAll(async () => { await app.close(); });
  beforeEach(async () => { await resetDb(); });

  it('subscribe activates premium and records a transaction', async () => {
    const u = await registerUser(app);
    const res = await app.inject({
      method: 'POST', url: '/billing/subscribe',
      headers: authHeader(u.accessToken), payload: { plan: 'annuel' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().isPremium).toBe(true);

    const status = await app.inject({ method: 'GET', url: '/billing/status', headers: authHeader(u.accessToken) });
    expect(status.json().isPremium).toBe(true);
    expect(status.json().transactions.length).toBe(1);
  });

  it('cancel ends the personal subscription immediately', async () => {
    const u = await registerUser(app);
    await app.inject({
      method: 'POST', url: '/billing/subscribe',
      headers: authHeader(u.accessToken), payload: { plan: 'annuel' },
    });

    const cancel = await app.inject({ method: 'POST', url: '/billing/cancel', headers: authHeader(u.accessToken) });
    expect(cancel.statusCode).toBe(200);
    expect(cancel.json().isPremium).toBe(false);
    expect(cancel.json().premiumUntil).toBeNull();

    const status = await app.inject({ method: 'GET', url: '/billing/status', headers: authHeader(u.accessToken) });
    expect(status.json().isPremium).toBe(false);
  });

  it('cancel fails when there is no personal subscription to cancel', async () => {
    const u = await registerUser(app);
    const res = await app.inject({ method: 'POST', url: '/billing/cancel', headers: authHeader(u.accessToken) });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('NO_PERSONAL_SUBSCRIPTION');
  });

  it('repair-streak restores lastStreakValue', async () => {
    const u = await registerUser(app);
    // Simulate a broken streak: lastStreakValue=12, streak=0.
    await prisma.user.update({
      where: { id: u.userId },
      data: { streak: 0, lastStreakValue: 12 },
    });
    const res = await app.inject({ method: 'POST', url: '/billing/repair-streak', headers: authHeader(u.accessToken) });
    expect(res.statusCode).toBe(200);
    expect(res.json().streak).toBe(12);
  });

  it('repair-streak fails when there is nothing to repair', async () => {
    const u = await registerUser(app);
    const res = await app.inject({ method: 'POST', url: '/billing/repair-streak', headers: authHeader(u.accessToken) });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('NO_STREAK_TO_REPAIR');
  });
});

d('leagues ranking (integration)', () => {
  let app: FastifyInstance;
  beforeAll(async () => { app = await makeApp(); });
  afterAll(async () => { await app.close(); });
  beforeEach(async () => { await resetDb(); });

  async function currentWeek() {
    const league = await prisma.league.create({ data: { nom: 'Or', niveau: 3, ordre: 1 } });
    const now = new Date();
    return prisma.leagueWeek.create({
      data: {
        leagueId: league.id, numeroSemaine: 1,
        dateDebut: new Date(now.getTime() - 86400000),
        dateFin: new Date(now.getTime() + 6 * 86400000),
      },
    });
  }

  it('computes my rank from weeklyXp ordering', async () => {
    const week = await currentWeek();
    const me = await registerUser(app);

    // Two higher-XP opponents and one lower.
    const mk = async (xp: number) => {
      const u = await prisma.user.create({ data: { email: `op${xp}@t.app`, displayName: `Op ${xp}`, weeklyXp: xp } });
      await prisma.leagueMembership.create({ data: { userId: u.id, leagueWeekId: week.id, weeklyXp: xp } });
    };
    await mk(1000);
    await mk(800);
    await prisma.user.update({ where: { id: me.userId }, data: { weeklyXp: 900 } });

    await app.inject({ method: 'POST', url: '/leagues/join', headers: authHeader(me.accessToken) });
    await mk(100);

    const res = await app.inject({ method: 'GET', url: '/leagues/me', headers: authHeader(me.accessToken) });
    const body = res.json();
    // 1000 > 900(me) > 800 > 100  => rank 2.
    expect(body.myRank).toBe(2);
    expect(body.participants).toBe(4);
    expect(body.podium[0].weeklyXp).toBe(1000);
  });

  it('shows the public username in the ranking, never the full name', async () => {
    await currentWeek();
    const me = await registerUser(app, { displayName: 'Medoune Seck', username: 'medoune_s' });
    await app.inject({ method: 'POST', url: '/leagues/join', headers: authHeader(me.accessToken) });

    const res = await app.inject({ method: 'GET', url: '/leagues/me', headers: authHeader(me.accessToken) });
    const body = res.json();
    const mine = [...body.podium, ...body.around].find((m: { me: boolean }) => m.me);
    expect(mine.name).toBe('medoune_s');

    // Uniqueness: the same username cannot be registered twice.
    const dup = await app.inject({
      method: 'POST', url: '/auth/register',
      payload: { email: 'dup-username@test.app', password: 'password123', displayName: 'X', username: 'medoune_s', deviceId: 'd' },
    });
    expect(dup.statusCode).toBe(409);
    expect(dup.json().error.code).toBe('USERNAME_TAKEN');
  });

  it('lesson XP flows into the league weekly ranking', async () => {
    const week = await currentWeek();
    const me = await registerUser(app);
    await app.inject({ method: 'POST', url: '/leagues/join', headers: authHeader(me.accessToken) });

    // Build a lesson and complete it.
    const section = await prisma.section.create({
      data: { ordre: 1, kicker: 'T', titre: 'T', sousTitre: '', couleur: '#000', degradeStart: '#000', degradeEnd: '#111', headerIcon: 'x' },
    });
    const lesson = await prisma.lesson.create({ data: { sectionId: section.id, ordre: 1, titre: 'L' } });

    // Lesson has no test steps; XP = 15 base (correctCount 0).
    await app.inject({ method: 'POST', url: `/lessons/${lesson.id}/complete`, headers: authHeader(me.accessToken), payload: {} });

    const membership = await prisma.leagueMembership.findFirst({ where: { userId: me.userId, leagueWeekId: week.id } });
    expect(membership?.weeklyXp).toBe(15);
  });
});

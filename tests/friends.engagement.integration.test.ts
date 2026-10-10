import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { DB_TESTS, makeApp, resetDb, registerUser, authHeader } from './helpers/testApp.js';
import { env } from '../src/config/env.js';
import { prisma } from '../src/config/prisma.js';

const d = DB_TESTS && env.FRIENDS_ENABLED ? describe : describe.skip;

/** Crée deux amis (a, b) et renvoie leurs identifiants + tokens. */
async function makeFriends(app: FastifyInstance) {
  const a = await registerUser(app, { email: 'a@test.app' });
  const b = await registerUser(app, { email: 'b@test.app' });
  const code = (await app.inject({
    method: 'GET', url: '/me/friends/code', headers: authHeader(a.accessToken),
  })).json().code as string;
  await app.inject({
    method: 'POST', url: '/me/friends/add', headers: authHeader(b.accessToken), payload: { code },
  });
  return { a, b };
}

d('friends engagement (integration)', () => {
  let app: FastifyInstance;
  beforeAll(async () => { app = await makeApp(); });
  afterAll(async () => { await app.close(); });
  beforeEach(async () => { await resetDb(); });

  it('classement : moi + amis, trié par weeklyXp', async () => {
    const { a, b } = await makeFriends(app);
    await prisma.user.update({ where: { id: b.userId }, data: { weeklyXp: 120, streak: 4 } });

    const res = await app.inject({ method: 'GET', url: '/me/friends/leaderboard', headers: authHeader(a.accessToken) });
    expect(res.statusCode).toBe(200);
    const entries = res.json().entries as Array<{ isMe: boolean; user: { id: string }; weeklyXp: number }>;
    expect(entries).toHaveLength(2);
    expect(entries[0]!.user.id).toBe(b.userId);
    expect(entries[0]!.weeklyXp).toBe(120);
    expect(entries.some((e) => e.isMe)).toBe(true);
  });

  it('fil d’activité : publie une réussite et permet de réagir', async () => {
    const { a, b } = await makeFriends(app);
    await prisma.friendActivity.create({
      data: { userId: a.userId, type: 'sourate_mastered', data: { numero: 1, nom: 'Al-Fatiha' } },
    });

    const feed = await app.inject({ method: 'GET', url: '/me/friends/activity', headers: authHeader(b.accessToken) });
    expect(feed.statusCode).toBe(200);
    const posts = feed.json().activity as Array<{ id: string; cheers: number; cheeredByMe: boolean }>;
    expect(posts).toHaveLength(1);
    expect(posts[0]!.cheers).toBe(0);

    const cheer = await app.inject({
      method: 'POST', url: `/me/friends/activity/${posts[0]!.id}/cheer`, headers: authHeader(b.accessToken),
    });
    expect(cheer.statusCode).toBe(200);
    expect(cheer.json()).toEqual({ cheered: true, cheers: 1 });
  });

  it('défi : créer, lister, lire, quitter', async () => {
    const { a, b } = await makeFriends(app);
    const endsAt = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString();

    const create = await app.inject({
      method: 'POST', url: '/me/friends/challenges', headers: authHeader(a.accessToken),
      payload: { title: 'Défi XP', metric: 'xp', targetValue: 200, endsAt, friendIds: [b.userId] },
    });
    expect(create.statusCode).toBe(200);
    const challengeId = create.json().id as string;
    expect(create.json().participants).toHaveLength(2);

    const list = await app.inject({ method: 'GET', url: '/me/friends/challenges', headers: authHeader(b.accessToken) });
    expect(list.json().challenges).toHaveLength(1);

    const leave = await app.inject({
      method: 'DELETE', url: `/me/friends/challenges/${challengeId}`, headers: authHeader(b.accessToken),
    });
    expect(leave.statusCode).toBe(200);
    expect(leave.json().left).toBe(true);
  });

  it('envois : quota 3/jour puis 429, le destinataire reçoit le message', async () => {
    const { a, b } = await makeFriends(app);

    for (let i = 0; i < 3; i++) {
      const res = await app.inject({
        method: 'POST', url: `/me/friends/${b.userId}/send`, headers: authHeader(a.accessToken),
        payload: { type: 'encouragement', text: `Bravo ${i}` },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().quota.used).toBe(i + 1);
    }

    const over = await app.inject({
      method: 'POST', url: `/me/friends/${b.userId}/send`, headers: authHeader(a.accessToken),
      payload: { type: 'encouragement', text: 'encore' },
    });
    expect(over.statusCode).toBe(429);

    const inbox = await app.inject({ method: 'GET', url: '/me/friends/inbox', headers: authHeader(b.accessToken) });
    expect(inbox.json().unread).toBe(3);
    expect(inbox.json().messages[0].type).toBe('encouragement');

    const firstId = inbox.json().messages[0].id as string;
    const read = await app.inject({
      method: 'POST', url: `/me/friends/inbox/${firstId}/read`, headers: authHeader(b.accessToken),
    });
    expect(read.statusCode).toBe(200);
  });
});

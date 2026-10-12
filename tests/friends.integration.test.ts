import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { DB_TESTS, makeApp, resetDb, registerUser, authHeader } from './helpers/testApp.js';
import { env } from '../src/config/env.js';

// Ces tests touchent Postgres ET n'ont de sens que si la fonctionnalité amis
// est activée côté serveur. Sinon on les ignore.
const d = DB_TESTS && env.FRIENDS_ENABLED ? describe : describe.skip;

d('friends (integration)', () => {
  let app: FastifyInstance;
  beforeAll(async () => { app = await makeApp(); });
  afterAll(async () => { await app.close(); });
  beforeEach(async () => { await resetDb(); });

  it('génère mon code de façon stable (idempotent)', async () => {
    const me = await registerUser(app);
    const a = await app.inject({ method: 'GET', url: '/me/friends/code', headers: authHeader(me.accessToken) });
    const b = await app.inject({ method: 'GET', url: '/me/friends/code', headers: authHeader(me.accessToken) });
    expect(a.statusCode).toBe(200);
    expect(a.json().code).toHaveLength(6);
    expect(b.json().code).toBe(a.json().code);
  });

  it('ajoute un ami par code, immédiatement, des deux côtés', async () => {
    const a = await registerUser(app, { email: 'a@test.app' });
    const b = await registerUser(app, { email: 'b@test.app' });

    const code = (await app.inject({
      method: 'GET', url: '/me/friends/code', headers: authHeader(a.accessToken),
    })).json().code as string;

    const add = await app.inject({
      method: 'POST', url: '/me/friends/add', headers: authHeader(b.accessToken), payload: { code },
    });
    expect(add.statusCode).toBe(200);
    expect(add.json().friendshipId).toBeTruthy();
    expect(add.json().user.id).toBe(a.userId);

    const bList = await app.inject({ method: 'GET', url: '/me/friends', headers: authHeader(b.accessToken) });
    const aList = await app.inject({ method: 'GET', url: '/me/friends', headers: authHeader(a.accessToken) });
    expect(bList.json().friends).toHaveLength(1);
    expect(aList.json().friends).toHaveLength(1);
    expect(aList.json().friends[0].user.id).toBe(b.userId);
  });

  it('refuse un code inconnu, soi-même et un doublon', async () => {
    const a = await registerUser(app, { email: 'a2@test.app' });
    const b = await registerUser(app, { email: 'b2@test.app' });

    const bad = await app.inject({
      method: 'POST', url: '/me/friends/add', headers: authHeader(b.accessToken), payload: { code: 'ZZZZZZ' },
    });
    expect(bad.statusCode).toBe(404);

    const mine = (await app.inject({
      method: 'GET', url: '/me/friends/code', headers: authHeader(a.accessToken),
    })).json().code as string;

    const self = await app.inject({
      method: 'POST', url: '/me/friends/add', headers: authHeader(a.accessToken), payload: { code: mine },
    });
    expect(self.statusCode).toBe(400);

    await app.inject({ method: 'POST', url: '/me/friends/add', headers: authHeader(b.accessToken), payload: { code: mine } });
    const dup = await app.inject({
      method: 'POST', url: '/me/friends/add', headers: authHeader(b.accessToken), payload: { code: mine },
    }).then((r) => r);
    expect(dup.statusCode).toBe(409);
    void a; void b;
  });

  it('retire une amitié, la masque des deux côtés', async () => {
    const a = await registerUser(app, { email: 'a3@test.app' });
    const b = await registerUser(app, { email: 'b3@test.app' });
    const code = (await app.inject({
      method: 'GET', url: '/me/friends/code', headers: authHeader(a.accessToken),
    })).json().code as string;
    const { friendshipId } = (await app.inject({
      method: 'POST', url: '/me/friends/add', headers: authHeader(b.accessToken), payload: { code },
    })).json();

    const del = await app.inject({
      method: 'DELETE', url: `/me/friends/${friendshipId}`, headers: authHeader(b.accessToken),
    });
    expect(del.statusCode).toBe(200);

    const aList = await app.inject({ method: 'GET', url: '/me/friends', headers: authHeader(a.accessToken) });
    expect(aList.json().friends).toHaveLength(0);
  });

  it('le blocage retire l’amitié et empêche un nouvel ajout', async () => {
    const a = await registerUser(app, { email: 'a4@test.app' });
    const b = await registerUser(app, { email: 'b4@test.app' });
    const code = (await app.inject({
      method: 'GET', url: '/me/friends/code', headers: authHeader(a.accessToken),
    })).json().code as string;
    await app.inject({ method: 'POST', url: '/me/friends/add', headers: authHeader(b.accessToken), payload: { code } });

    const block = await app.inject({
      method: 'POST', url: `/me/friends/${a.userId}/block`, headers: authHeader(b.accessToken),
    });
    expect(block.statusCode).toBe(200);

    const aList = await app.inject({ method: 'GET', url: '/me/friends', headers: authHeader(a.accessToken) });
    expect(aList.json().friends).toHaveLength(0);

    const retry = await app.inject({
      method: 'POST', url: '/me/friends/add', headers: authHeader(b.accessToken), payload: { code },
    });
    expect(retry.statusCode).toBe(403);
  });

  it('expose le progrès d’un ami (streak/xp/sourates)', async () => {
    const a = await registerUser(app, { email: 'a5@test.app' });
    const b = await registerUser(app, { email: 'b5@test.app' });
    const code = (await app.inject({
      method: 'GET', url: '/me/friends/code', headers: authHeader(a.accessToken),
    })).json().code as string;
    await app.inject({ method: 'POST', url: '/me/friends/add', headers: authHeader(b.accessToken), payload: { code } });

    const prog = await app.inject({
      method: 'GET', url: `/me/friends/${a.userId}/progress`, headers: authHeader(b.accessToken),
    });
    expect(prog.statusCode).toBe(200);
    expect(prog.json().user.id).toBe(a.userId);
    expect(typeof prog.json().streak).toBe('number');
    expect(Array.isArray(prog.json().masteredSourateNumeros)).toBe(true);
    // Règle 6 : aucune fuite de champ sensible dans la vue ami.
    expect(Object.keys(prog.json().user).sort()).toEqual([
      'avatarInitials', 'displayName', 'id', 'username',
    ]);
  });

  it('l’acteur est toujours le token, jamais un userId du body/query (règle 5)', async () => {
    const a = await registerUser(app, { email: 'r5a@test.app' });
    const b = await registerUser(app, { email: 'r5b@test.app' });

    const aCode = (await app.inject({
      method: 'GET', url: '/me/friends/code', headers: authHeader(a.accessToken),
    })).json().code as string;

    // B tente de se faire passer pour A via la query : on renvoie le code de B.
    const bCode = (await app.inject({
      method: 'GET', url: `/me/friends/code?userId=${a.userId}`, headers: authHeader(b.accessToken),
    })).json().code as string;
    expect(bCode).toHaveLength(6);
    expect(bCode).not.toBe(aCode);

    const aStill = (await app.inject({
      method: 'GET', url: '/me/friends/code', headers: authHeader(a.accessToken),
    })).json().code as string;
    expect(aStill).toBe(aCode);
  });

  it('un non-ami n’accède ni au progrès ni à l’envoi (règle 5)', async () => {
    const a = await registerUser(app, { email: 'r5c@test.app' });
    const b = await registerUser(app, { email: 'r5d@test.app' });

    const prog = await app.inject({
      method: 'GET', url: `/me/friends/${a.userId}/progress`, headers: authHeader(b.accessToken),
    });
    expect(prog.statusCode).toBe(404);

    const send = await app.inject({
      method: 'POST', url: `/me/friends/${a.userId}/send`, headers: authHeader(b.accessToken),
      payload: { type: 'encouragement' },
    });
    expect(send.statusCode).toBe(404);
  });
});

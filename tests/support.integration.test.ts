import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { DB_TESTS, makeApp, resetDb, registerUser, authHeader } from './helpers/testApp.js';
import { prisma } from '../src/config/prisma.js';

const d = DB_TESTS ? describe : describe.skip;

d('support: send message (integration)', () => {
  let app: FastifyInstance;
  beforeAll(async () => { app = await makeApp(); });
  afterAll(async () => { await app.close(); });
  beforeEach(async () => { await resetDb(); });

  it('records a support message for the authenticated user', async () => {
    const u = await registerUser(app);
    const res = await app.inject({
      method: 'POST', url: '/me/support',
      headers: authHeader(u.accessToken), payload: { message: 'Le bouton de révision plante sur mon téléphone.' },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().id).toBeTruthy();

    const stored = await prisma.supportMessage.findFirst({ where: { userId: u.userId } });
    expect(stored?.message).toBe('Le bouton de révision plante sur mon téléphone.');
    expect(stored?.read).toBe(false);
  });

  it('rejects an empty message', async () => {
    const u = await registerUser(app);
    const res = await app.inject({
      method: 'POST', url: '/me/support',
      headers: authHeader(u.accessToken), payload: { message: '' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('rejects an unauthenticated request', async () => {
    const res = await app.inject({
      method: 'POST', url: '/me/support', payload: { message: 'Hello' },
    });
    expect(res.statusCode).toBe(401);
  });
});

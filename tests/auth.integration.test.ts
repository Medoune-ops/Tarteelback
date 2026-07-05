import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { DB_TESTS, makeApp, resetDb, registerUser } from './helpers/testApp.js';

const d = DB_TESTS ? describe : describe.skip;

d('auth & persistent session (integration)', () => {
  let app: FastifyInstance;
  beforeAll(async () => { app = await makeApp(); });
  afterAll(async () => { await app.close(); });
  beforeEach(async () => { await resetDb(); });

  it('registers and returns access + refresh tokens', async () => {
    const u = await registerUser(app);
    expect(u.accessToken).toBeTruthy();
    expect(u.refreshToken).toBeTruthy();
    expect(u.userId).toBeTruthy();
  });

  it('rejects duplicate email', async () => {
    await registerUser(app, { email: 'dup@test.app' });
    const res = await app.inject({
      method: 'POST', url: '/auth/register',
      payload: { email: 'dup@test.app', password: 'password123', displayName: 'X', deviceId: 'd' },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('EMAIL_TAKEN');
  });

  it('logs in with correct credentials, rejects wrong password', async () => {
    await registerUser(app, { email: 'login@test.app', password: 'rightpass1' });
    const ok = await app.inject({
      method: 'POST', url: '/auth/login',
      payload: { email: 'login@test.app', password: 'rightpass1', deviceId: 'd1' },
    });
    expect(ok.statusCode).toBe(200);

    const bad = await app.inject({
      method: 'POST', url: '/auth/login',
      payload: { email: 'login@test.app', password: 'wrong', deviceId: 'd1' },
    });
    expect(bad.statusCode).toBe(401);
    expect(bad.json().error.code).toBe('INVALID_CREDENTIALS');
  });

  it('refresh rotates the token; the old one stops working', async () => {
    const u = await registerUser(app, { deviceId: 'phone-A' });

    const r1 = await app.inject({
      method: 'POST', url: '/auth/refresh',
      payload: { refreshToken: u.refreshToken, deviceId: 'phone-A' },
    });
    expect(r1.statusCode).toBe(200);
    const newRefresh = r1.json().refreshToken;
    expect(newRefresh).not.toBe(u.refreshToken);

    // Old token is now revoked (rotation).
    const reuse = await app.inject({
      method: 'POST', url: '/auth/refresh',
      payload: { refreshToken: u.refreshToken, deviceId: 'phone-A' },
    });
    expect(reuse.statusCode).toBe(401);
  });

  it('logout revokes the session; refresh then fails', async () => {
    const u = await registerUser(app, { deviceId: 'phone-B' });
    const out = await app.inject({
      method: 'POST', url: '/auth/logout',
      payload: { refreshToken: u.refreshToken },
    });
    expect(out.statusCode).toBe(204);

    const res = await app.inject({
      method: 'POST', url: '/auth/refresh',
      payload: { refreshToken: u.refreshToken, deviceId: 'phone-B' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('a new device (no stored token) has no session', async () => {
    // A brand-new install simply has no refresh token to present.
    const res = await app.inject({
      method: 'POST', url: '/auth/refresh',
      payload: { refreshToken: 'never-issued', deviceId: 'fresh-install' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('GET /me requires a valid token and returns the flat store shape', async () => {
    const u = await registerUser(app);
    const anon = await app.inject({ method: 'GET', url: '/me' });
    expect(anon.statusCode).toBe(401);

    const me = await app.inject({ method: 'GET', url: '/me', headers: { authorization: `Bearer ${u.accessToken}` } });
    expect(me.statusCode).toBe(200);
    const body = me.json();
    // Flat contract consumed by the RN store's hydrateFromBackend (BACKEND.md).
    expect(body.hearts).toBe(5);
    expect(body.lastHeartLossAt).toBeNull();
    expect(body.currentLesson).toBe(1);
    expect(body).toMatchObject({
      streak: expect.any(Number),
      xp: expect.any(Number),
      isPremium: expect.any(Boolean),
      sourates: expect.any(Number),
      precision: expect.any(Number),
      voiceEnabled: expect.any(Boolean),
    });
  });

  it('DELETE /me requires the password, then erases the account for good', async () => {
    const u = await registerUser(app, { email: 'delete-me@test.app', password: 'password123' });
    const auth = { authorization: `Bearer ${u.accessToken}` };

    // A stolen access token alone must NOT be able to destroy the account.
    const noPass = await app.inject({ method: 'DELETE', url: '/me', headers: auth });
    expect(noPass.statusCode).toBe(401);
    const badPass = await app.inject({
      method: 'DELETE', url: '/me', headers: auth, payload: { password: 'wrong-password' },
    });
    expect(badPass.statusCode).toBe(401);

    const del = await app.inject({
      method: 'DELETE', url: '/me', headers: auth, payload: { password: 'password123' },
    });
    expect(del.statusCode).toBe(204);

    // The user row is gone: /me now 404s, a second delete too.
    const me = await app.inject({ method: 'GET', url: '/me', headers: auth });
    expect(me.statusCode).toBe(404);
    const again = await app.inject({
      method: 'DELETE', url: '/me', headers: auth, payload: { password: 'password123' },
    });
    expect(again.statusCode).toBe(404);

    // And the credentials no longer log in.
    const login = await app.inject({
      method: 'POST', url: '/auth/login',
      payload: { email: 'delete-me@test.app', password: 'password123', deviceId: 'd' },
    });
    expect(login.statusCode).toBe(401);
  });
});

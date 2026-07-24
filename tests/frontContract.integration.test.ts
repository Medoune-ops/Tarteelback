import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { DB_TESTS, makeApp, resetDb, registerUser, authHeader } from './helpers/testApp.js';
import { prisma } from '../src/config/prisma.js';
import { hashToken } from '../src/core/tokens.js';

const d = DB_TESTS ? describe : describe.skip;

/** Minimal section + lesson with one written test step (correct option = 'A'). */
async function makeLesson() {
  const section = await prisma.section.create({
    data: {
      ordre: Math.floor(Math.random() * 1e9),
      kicker: 'T', titre: 'T', sousTitre: '', couleur: '#000',
      degradeStart: '#000', degradeEnd: '#111', headerIcon: 'x',
    },
  });
  const lesson = await prisma.lesson.create({
    data: { sectionId: section.id, ordre: 1, titre: 'Test lesson' },
  });
  await prisma.lessonStep.create({
    data: {
      lessonId: lesson.id, ordre: 1, type: 'written',
      payload: { consigne: '?', arabe: 'x', options: [{ id: 'A', text: 'a' }], bonneReponse: 'A' },
    },
  });
  return lesson;
}

d('front contract: flat /me, /lesson/complete, settings (integration)', () => {
  let app: FastifyInstance;
  beforeAll(async () => { app = await makeApp(); });
  afterAll(async () => { await app.close(); });
  beforeEach(async () => { await resetDb(); });

  it('GET /me returns the flat store shape', async () => {
    const u = await registerUser(app);
    const res = await app.inject({ method: 'GET', url: '/me', headers: authHeader(u.accessToken) });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toMatchObject({
      streak: 0, xp: 0, hearts: 5, isPremium: false,
      currentLesson: 1, lastHeartLossAt: null, sourates: 0, precision: 0,
    });
    // No rich/nested fields leak into the flat contract.
    expect(body.user).toBeUndefined();
    expect(typeof body.hearts).toBe('number');
  });

  it('POST /lesson/complete credits XP and returns the flat shape; currentLesson advances', async () => {
    const u = await registerUser(app);
    const lesson = await makeLesson();

    const done = await app.inject({
      method: 'POST', url: '/lesson/complete',
      headers: authHeader(u.accessToken),
      payload: { lessonId: lesson.id, correctAnswers: 1, totalAnswers: 1, durationMs: 1000 },
    });
    expect(done.statusCode).toBe(200);
    const body = done.json();
    expect(body.xp).toBe(17); // 15 base + 1×2
    expect(body.streak).toBe(1);
    expect(body.currentLesson).toBe(2); // one lesson completed → next is 2
    expect(body.precision).toBe(100);

    // Idempotent: replaying does not farm XP.
    const again = await app.inject({
      method: 'POST', url: '/lesson/complete',
      headers: authHeader(u.accessToken),
      payload: { lessonId: lesson.id, correctAnswers: 1, totalAnswers: 1 },
    });
    expect(again.json().xp).toBe(17);
  });

  it('PATCH /me/settings updates voice/language and returns the flat shape', async () => {
    const u = await registerUser(app);
    const res = await app.inject({
      method: 'PATCH', url: '/me/settings',
      headers: authHeader(u.accessToken),
      payload: { voiceEnabled: false, language: 'en' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().hearts).toBe(5); // flat shape echoed back

    const fresh = await prisma.user.findUniqueOrThrow({ where: { id: u.userId } });
    expect(fresh.voiceEnabled).toBe(false);
    expect(fresh.language).toBe('en');
  });

  it("PATCH /me { displayName } renames and echoes the flat `name` (edit-profile flow)", async () => {
    const u = await registerUser(app);
    const res = await app.inject({
      method: 'PATCH', url: '/me',
      headers: authHeader(u.accessToken),
      payload: { displayName: 'Nouveau Nom' },
    });
    expect(res.statusCode).toBe(200);
    // The flat shape exposes it as `name` — what the RN store hydrates from.
    expect(res.json().name).toBe('Nouveau Nom');

    // `name` is NOT a schema field (the front must map it to displayName).
    const wrongKey = await app.inject({
      method: 'PATCH', url: '/me',
      headers: authHeader(u.accessToken),
      payload: { name: 'X' },
    });
    expect(wrongKey.statusCode).toBe(400);
  });

  it('PATCH /me { username } sets the public pseudo (accounts created without one)', async () => {
    const u = await registerUser(app); // pas de username à l'inscription
    const res = await app.inject({
      method: 'PATCH', url: '/me',
      headers: authHeader(u.accessToken),
      payload: { username: 'Mon_Pseudo' }, // normalisé en minuscules
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().username).toBe('mon_pseudo');

    // Un autre compte ne peut pas prendre le même pseudo.
    const other = await registerUser(app);
    const dup = await app.inject({
      method: 'PATCH', url: '/me',
      headers: authHeader(other.accessToken),
      payload: { username: 'mon_pseudo' },
    });
    expect(dup.statusCode).toBe(409);
    expect(dup.json().error.code).toBe('USERNAME_TAKEN');
  });

  it('PATCH /me/settings rejects unknown keys (mass-assignment guard)', async () => {
    const u = await registerUser(app);
    const res = await app.inject({
      method: 'PATCH', url: '/me/settings',
      headers: authHeader(u.accessToken),
      payload: { isPremium: true },
    });
    expect(res.statusCode).toBe(400);
  });
});

d('front contract: password reset & change (integration)', () => {
  let app: FastifyInstance;
  beforeAll(async () => { app = await makeApp(); });
  afterAll(async () => { await app.close(); });
  beforeEach(async () => { await resetDb(); });

  it('change-password requires the current password and rotates sessions', async () => {
    const u = await registerUser(app, { email: 'cp@test.app', password: 'OldPass123' });

    const wrong = await app.inject({
      method: 'POST', url: '/auth/change-password',
      headers: authHeader(u.accessToken),
      payload: { currentPassword: 'nope', newPassword: 'NewPass123' },
    });
    expect(wrong.statusCode).toBe(401);

    const ok = await app.inject({
      method: 'POST', url: '/auth/change-password',
      headers: authHeader(u.accessToken),
      payload: { currentPassword: 'OldPass123', newPassword: 'NewPass123' },
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toEqual({ ok: true });

    // Old refresh token was revoked by the password change.
    const refreshed = await app.inject({
      method: 'POST', url: '/auth/refresh',
      payload: { refreshToken: u.refreshToken, deviceId: u.deviceId },
    });
    expect(refreshed.statusCode).toBe(401);

    // The new password logs in.
    const login = await app.inject({
      method: 'POST', url: '/auth/login',
      payload: { email: 'cp@test.app', password: 'NewPass123', deviceId: 'd2' },
    });
    expect(login.statusCode).toBe(200);
  });

  it('reset-password request is silent for unknown emails (no enumeration)', async () => {
    const res = await app.inject({
      method: 'POST', url: '/auth/reset-password/request',
      payload: { email: 'nobody@nowhere.app' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
    expect(await prisma.passwordResetToken.count()).toBe(0);
  });

  it('reset-password request → confirm sets a new password and burns the token', async () => {
    const u = await registerUser(app, { email: 'rp@test.app', password: 'OldPass123' });

    const req = await app.inject({
      method: 'POST', url: '/auth/reset-password/request',
      payload: { email: 'rp@test.app' },
    });
    expect(req.statusCode).toBe(200);

    // The plaintext token is emailed (logged in dev); we can't read it here, so
    // we mint a known token directly to exercise the confirm path end-to-end.
    await prisma.passwordResetToken.deleteMany({ where: { userId: u.userId } });
    const token = 'known-reset-token-abc';
    await prisma.passwordResetToken.create({
      data: {
        userId: u.userId,
        tokenHash: hashToken(token),
        expiresAt: new Date(Date.now() + 60_000),
      },
    });

    const confirm = await app.inject({
      method: 'POST', url: '/auth/reset-password/confirm',
      payload: { token, newPassword: 'BrandNew123' },
    });
    expect(confirm.statusCode).toBe(200);

    // New password works; token can't be reused.
    const login = await app.inject({
      method: 'POST', url: '/auth/login',
      payload: { email: 'rp@test.app', password: 'BrandNew123', deviceId: 'd3' },
    });
    expect(login.statusCode).toBe(200);

    const reuse = await app.inject({
      method: 'POST', url: '/auth/reset-password/confirm',
      payload: { token, newPassword: 'Another123' },
    });
    expect(reuse.statusCode).toBe(401); // TOKEN_EXPIRED (already used)
  });
});

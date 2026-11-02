import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { DB_TESTS, makeApp, resetDb, registerUser, authHeader } from './helpers/testApp.js';
import { GOOGLE_AUD, APPLE_AUD, makeSocialProvider } from './helpers/socialTokens.js';

const fake = vi.hoisted(() => ({ keys: null as null | ((...a: unknown[]) => unknown) }));
vi.mock('jose', async (original) => ({
  ...(await original<typeof import('jose')>()),
  createRemoteJWKSet: () => (...a: unknown[]) => fake.keys!(...a),
}));

import { env } from '../src/config/env.js';
import { prisma } from '../src/config/prisma.js';

const d = DB_TESTS ? describe : describe.skip;

d('POST /auth/social (integration)', () => {
  let app: FastifyInstance;
  let provider: Awaited<ReturnType<typeof makeSocialProvider>>;

  beforeAll(async () => {
    env.GOOGLE_CLIENT_IDS = [GOOGLE_AUD];
    env.APPLE_CLIENT_IDS = [APPLE_AUD];
    provider = await makeSocialProvider();
    fake.keys = provider.jwks as never;
    app = await makeApp();
  });
  afterAll(async () => { await app.close(); });
  beforeEach(async () => { await resetDb(); });

  const signIn = (payload: Record<string, unknown>) =>
    app.inject({ method: 'POST', url: '/auth/social', payload: { deviceId: 'device-1', ...payload } });

  const googleToken = (sub = 'g-1', email = 'awa@gmail.com', extra: Record<string, unknown> = {}) =>
    provider.token('google', { sub, claims: { email, email_verified: true, name: 'Awa Ndiaye', ...extra } });

  it('crée le compte à la première connexion et ouvre une session qui marche', async () => {
    const res = await signIn({ provider: 'google', idToken: await googleToken(), timezone: 'Africa/Dakar', language: 'fr' });

    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.isNewUser).toBe(true);
    expect(body.user.email).toBe('awa@gmail.com');
    expect(body.user.displayName).toBe('Awa Ndiaye');

    const stored = await prisma.user.findUniqueOrThrow({ where: { email: 'awa@gmail.com' } });
    expect(stored.passwordHash).toBeNull();
    expect(stored.emailVerified).toBe(true);
    expect(stored.timezone).toBe('Africa/Dakar');

    const me = await app.inject({ method: 'GET', url: '/me', headers: authHeader(body.accessToken) });
    expect(me.statusCode).toBe(200);

    const refreshed = await app.inject({
      method: 'POST', url: '/auth/refresh',
      payload: { refreshToken: body.refreshToken, deviceId: 'device-1' },
    });
    expect(refreshed.statusCode).toBe(200);
  });

  it('reconnecte le même compte sans en créer un autre', async () => {
    const first = await signIn({ provider: 'google', idToken: await googleToken() });
    const second = await signIn({ provider: 'google', idToken: await googleToken() });

    expect(second.statusCode).toBe(200);
    expect(second.json().isNewUser).toBe(false);
    expect(second.json().user.id).toBe(first.json().user.id);
    expect(await prisma.user.count()).toBe(1);
  });

  it('retrouve le compte par son identifiant, même si l’email a changé ou manque', async () => {
    const first = await signIn({
      provider: 'apple',
      idToken: await provider.token('apple', { sub: 'a-1', claims: { email: 'x@privaterelay.appleid.com', email_verified: 'true' } }),
      displayName: 'Awa',
    });
    expect(first.statusCode).toBe(201);
    expect(first.json().user.displayName).toBe('Awa');

    const second = await signIn({ provider: 'apple', idToken: await provider.token('apple', { sub: 'a-1' }) });
    expect(second.statusCode).toBe(200);
    expect(second.json().user.id).toBe(first.json().user.id);
    expect(second.json().user.displayName).toBe('Awa');
  });

  it('ne met jamais l’email dans le nom affiché', async () => {
    const res = await signIn({
      provider: 'apple',
      idToken: await provider.token('apple', { claims: { email: 'awa.ndiaye@gmail.com', email_verified: true } }),
    });
    expect(res.json().user.displayName).toBe('Tarteel');
  });

  it('refuse de créer un compte sans email ou avec un email non vérifié', async () => {
    const noEmail = await signIn({ provider: 'apple', idToken: await provider.token('apple', { sub: 'a-9' }) });
    expect(noEmail.statusCode).toBe(400);

    const unverified = await signIn({
      provider: 'google',
      idToken: await provider.token('google', { sub: 'g-9', claims: { email: 'x@gmail.com', email_verified: false } }),
    });
    expect(unverified.statusCode).toBe(400);
    expect(await prisma.user.count()).toBe(0);
  });

  it('un mauvais jeton ne crée rien', async () => {
    const res = await signIn({
      provider: 'google',
      idToken: await provider.token('google', {
        audience: 'autre-app', claims: { email: 'victim@gmail.com', email_verified: true },
      }),
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe('INVALID_CREDENTIALS');
    expect(await prisma.user.count()).toBe(0);
  });

  it('ne relie pas automatiquement un compte à mot de passe (prise de compte préparée)', async () => {
    const attacker = await registerUser(app, { email: 'victim@gmail.com', password: 'attacker-pass' });

    const res = await signIn({ provider: 'google', idToken: await googleToken('g-victim', 'victim@gmail.com') });

    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('EMAIL_TAKEN');
    expect(await prisma.socialIdentity.count()).toBe(0);

    // Le compte existant n'a pas changé.
    const login = await app.inject({
      method: 'POST', url: '/auth/login',
      payload: { email: 'victim@gmail.com', password: 'attacker-pass', deviceId: 'device-2' },
    });
    expect(login.json().user.id).toBe(attacker.userId);
  });

  it('relie Google et Apple quand ils prouvent le même email sur un compte sans mot de passe', async () => {
    const first = await signIn({ provider: 'google', idToken: await googleToken('g-1', 'awa@gmail.com') });
    const apple = await signIn({
      provider: 'apple',
      idToken: await provider.token('apple', { sub: 'a-1', claims: { email: 'awa@gmail.com', email_verified: 'true' } }),
    });

    expect(apple.statusCode).toBe(200);
    expect(apple.json().isNewUser).toBe(false);
    expect(apple.json().user.id).toBe(first.json().user.id);
    expect(await prisma.socialIdentity.count()).toBe(2);
  });

  it('un compte banni ne peut pas se connecter, et le nom envoyé ne change pas un compte existant', async () => {
    const first = await signIn({ provider: 'google', idToken: await googleToken() });
    const renamed = await signIn({ provider: 'google', idToken: await googleToken(), displayName: 'Autre nom' });
    expect(renamed.json().user.displayName).toBe('Awa Ndiaye');

    await prisma.user.update({ where: { id: first.json().user.id }, data: { bannedAt: new Date() } });
    const banned = await signIn({ provider: 'google', idToken: await googleToken() });
    expect(banned.statusCode).toBe(403);
    expect(banned.json().error.code).toBe('ACCOUNT_BANNED');
  });

  it('un double appui ne crée qu’un compte', async () => {
    const token = await googleToken('g-race', 'race@gmail.com');
    const all = await Promise.all(Array.from({ length: 5 }, () => signIn({ provider: 'google', idToken: token })));

    expect(all.every((r) => r.statusCode === 200 || r.statusCode === 201)).toBe(true);
    expect(new Set(all.map((r) => r.json().user.id)).size).toBe(1);
    expect(await prisma.user.count()).toBe(1);
    expect(await prisma.socialIdentity.count()).toBe(1);
  });

  it('refuse les champs inconnus : l’identité ne vient que du jeton', async () => {
    const res = await signIn({ provider: 'google', idToken: await googleToken(), email: 'other@gmail.com' });
    expect(res.statusCode).toBe(400);
    const role = await signIn({ provider: 'google', idToken: await googleToken(), role: 'admin' });
    expect(role.statusCode).toBe(400);
    expect(await prisma.user.count()).toBe(0);
  });

  it('supprimer le compte supprime aussi le lien avec le fournisseur', async () => {
    const first = await signIn({ provider: 'google', idToken: await googleToken() });
    const del = await app.inject({
      method: 'DELETE', url: '/me', headers: authHeader(first.json().accessToken), payload: {},
    });
    expect(del.statusCode).toBeLessThan(300);
    expect(await prisma.socialIdentity.count()).toBe(0);

    const again = await signIn({ provider: 'google', idToken: await googleToken() });
    expect(again.statusCode).toBe(201);
  });
});

import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { GOOGLE_AUD, APPLE_AUD, makeSocialProvider } from './helpers/socialTokens.js';

const fake = vi.hoisted(() => ({ keys: null as null | ((...a: unknown[]) => unknown) }));
vi.mock('jose', async (original) => ({
  ...(await original<typeof import('jose')>()),
  createRemoteJWKSet: () => (...a: unknown[]) => fake.keys!(...a),
}));

import { env } from '../src/config/env.js';
import { verifySocialToken } from '../src/core/socialIdentity.js';

function base64url(value: unknown) {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

describe('vérification des jetons Google et Apple', () => {
  let provider: Awaited<ReturnType<typeof makeSocialProvider>>;
  const saved = { google: env.GOOGLE_CLIENT_IDS, apple: env.APPLE_CLIENT_IDS };

  beforeAll(async () => { provider = await makeSocialProvider(); });
  beforeEach(() => {
    fake.keys = provider.jwks as never;
    env.GOOGLE_CLIENT_IDS = [GOOGLE_AUD];
    env.APPLE_CLIENT_IDS = [APPLE_AUD];
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => {
    env.GOOGLE_CLIENT_IDS = saved.google;
    env.APPLE_CLIENT_IDS = saved.apple;
    vi.restoreAllMocks();
  });

  const rejected = { code: 'INVALID_CREDENTIALS' };

  it('accepte un jeton Google valide et lit son identité', async () => {
    const token = await provider.token('google', {
      sub: 'g-1', claims: { email: 'Awa@Gmail.com', email_verified: true, name: 'Awa Ndiaye' },
    });
    await expect(verifySocialToken('google', token)).resolves.toEqual({
      provider: 'google', subject: 'g-1', email: 'awa@gmail.com', emailVerified: true, name: 'Awa Ndiaye',
    });
  });

  it('accepte le claim email_verified d’Apple sous forme de texte', async () => {
    const token = await provider.token('apple', {
      sub: 'a-1', claims: { email: 'x@privaterelay.appleid.com', email_verified: 'true' },
    });
    await expect(verifySocialToken('apple', token)).resolves.toMatchObject({
      subject: 'a-1', emailVerified: true, name: null,
    });
  });

  it('accepte un jeton Apple sans email', async () => {
    const token = await provider.token('apple', { sub: 'a-2' });
    await expect(verifySocialToken('apple', token)).resolves.toMatchObject({
      email: null, emailVerified: false,
    });
  });

  it('un email non vérifié reste marqué comme tel', async () => {
    const token = await provider.token('google', { claims: { email: 'a@b.c', email_verified: false } });
    await expect(verifySocialToken('google', token)).resolves.toMatchObject({ emailVerified: false });
  });

  it('refuse un jeton émis pour une autre application', async () => {
    const token = await provider.token('google', { audience: 'autre-app.apps.googleusercontent.com' });
    await expect(verifySocialToken('google', token)).rejects.toMatchObject(rejected);
  });

  it('refuse un jeton Google présenté comme un jeton Apple', async () => {
    const token = await provider.token('google');
    await expect(verifySocialToken('apple', token)).rejects.toMatchObject(rejected);
  });

  it('refuse un mauvais émetteur', async () => {
    const token = await provider.token('google', { issuer: 'https://evil.example' });
    await expect(verifySocialToken('google', token)).rejects.toMatchObject(rejected);
  });

  it('refuse un jeton expiré', async () => {
    const token = await provider.token('google', { expiresIn: '-1h' });
    await expect(verifySocialToken('google', token)).rejects.toMatchObject(rejected);
  });

  it('refuse un jeton signé avec une autre clé', async () => {
    const token = await provider.token('google', { key: provider.otherPrivateKey });
    await expect(verifySocialToken('google', token)).rejects.toMatchObject(rejected);
  });

  it('refuse un jeton non signé (alg none)', async () => {
    const payload = {
      sub: 'victim', iss: 'https://accounts.google.com', aud: GOOGLE_AUD,
      exp: Math.floor(Date.now() / 1000) + 3600, email: 'victim@gmail.com', email_verified: true,
    };
    const token = `${base64url({ alg: 'none' })}.${base64url(payload)}.`;
    await expect(verifySocialToken('google', token)).rejects.toMatchObject(rejected);
  });

  it('refuse un jeton illisible', async () => {
    await expect(verifySocialToken('google', 'pas-un-jeton')).rejects.toMatchObject(rejected);
  });

  it('une panne des clés du fournisseur est une indisponibilité, pas un mauvais jeton', async () => {
    fake.keys = () => { throw new TypeError('fetch failed'); };
    const token = await provider.token('google');
    await expect(verifySocialToken('google', token)).rejects.toMatchObject({ code: 'SERVICE_UNAVAILABLE' });
  });

  it('un fournisseur non configuré est refusé sans lire le jeton', async () => {
    env.APPLE_CLIENT_IDS = [];
    const token = await provider.token('apple');
    await expect(verifySocialToken('apple', token)).rejects.toMatchObject({ code: 'SERVICE_UNAVAILABLE' });
  });
});

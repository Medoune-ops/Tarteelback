import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT, type JWK } from 'jose';

export const GOOGLE_AUD = 'google-client-test.apps.googleusercontent.com';
export const APPLE_AUD = 'com.tarteel.test';

const ISSUERS = { google: 'https://accounts.google.com', apple: 'https://appleid.apple.com' };
const AUDIENCES = { google: GOOGLE_AUD, apple: APPLE_AUD };

type Provider = keyof typeof ISSUERS;
type Options = {
  claims?: Record<string, unknown>;
  sub?: string;
  issuer?: string;
  audience?: string;
  expiresIn?: string;
  key?: Awaited<ReturnType<typeof generateKeyPair>>['privateKey'];
};

/** Faux fournisseur : vraies clés et vraies signatures RS256, seul le réseau est remplacé. */
export async function makeSocialProvider() {
  const { publicKey, privateKey } = await generateKeyPair('RS256');
  const other = await generateKeyPair('RS256');
  const jwk: JWK = { ...(await exportJWK(publicKey)), kid: 'test-key', alg: 'RS256', use: 'sig' };

  return {
    jwks: createLocalJWKSet({ keys: [jwk] }),
    otherPrivateKey: other.privateKey,
    token(provider: Provider, opts: Options = {}) {
      return new SignJWT(opts.claims ?? {})
        .setProtectedHeader({ alg: 'RS256', kid: 'test-key' })
        .setSubject(opts.sub ?? 'sub-1')
        .setIssuer(opts.issuer ?? ISSUERS[provider])
        .setAudience(opts.audience ?? AUDIENCES[provider])
        .setIssuedAt()
        .setExpirationTime(opts.expiresIn ?? '1h')
        .sign(opts.key ?? privateKey);
    },
  };
}

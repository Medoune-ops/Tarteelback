import { createRemoteJWKSet, errors, jwtVerify } from 'jose';
import { env } from '../config/env.js';
import { AppError } from './errors.js';

export type SocialProvider = 'google' | 'apple';

export interface VerifiedSocialIdentity {
  provider: SocialProvider;
  /** Identifiant stable du compte chez le fournisseur (claim `sub`). */
  subject: string;
  email: string | null;
  emailVerified: boolean;
  name: string | null;
}

const PROVIDERS = {
  google: {
    jwks: createRemoteJWKSet(new URL('https://www.googleapis.com/oauth2/v3/certs')),
    issuer: ['https://accounts.google.com', 'accounts.google.com'],
    audience: () => env.GOOGLE_CLIENT_IDS,
  },
  apple: {
    jwks: createRemoteJWKSet(new URL('https://appleid.apple.com/auth/keys')),
    issuer: ['https://appleid.apple.com'],
    audience: () => env.APPLE_CLIENT_IDS,
  },
} as const;

/** Le jeton lui-même est mauvais. Toute autre erreur vient du fournisseur ou du réseau. */
function isRejectedToken(err: unknown): boolean {
  return (
    err instanceof errors.JWTExpired ||
    err instanceof errors.JWTClaimValidationFailed ||
    err instanceof errors.JWTInvalid ||
    err instanceof errors.JWSInvalid ||
    err instanceof errors.JWSSignatureVerificationFailed ||
    err instanceof errors.JOSEAlgNotAllowed ||
    err instanceof errors.JWKSNoMatchingKey ||
    err instanceof errors.JWKSMultipleMatchingKeys
  );
}

/**
 * Vérifie un jeton d'identité Google ou Apple : signature (clés publiques du
 * fournisseur), émetteur, expiration, et surtout audience — un jeton émis pour
 * une AUTRE application ne doit jamais ouvrir de session ici.
 */
export async function verifySocialToken(
  provider: SocialProvider,
  idToken: string,
): Promise<VerifiedSocialIdentity> {
  const config = PROVIDERS[provider];
  const audience = config.audience();
  if (audience.length === 0) {
    throw new AppError('SERVICE_UNAVAILABLE', `${provider} sign-in is not configured`);
  }

  let payload;
  try {
    ({ payload } = await jwtVerify(idToken, config.jwks, {
      algorithms: ['RS256'],
      issuer: [...config.issuer],
      audience,
      requiredClaims: ['sub', 'exp'],
      clockTolerance: 30,
    }));
  } catch (err) {
    if (isRejectedToken(err)) {
      throw new AppError('INVALID_CREDENTIALS', 'Invalid identity token');
    }
    // eslint-disable-next-line no-console
    console.error(`[auth] ${provider} keys unavailable:`, err);
    throw new AppError('SERVICE_UNAVAILABLE', `Unable to verify ${provider} sign-in`);
  }

  return {
    provider,
    subject: payload.sub!,
    email: typeof payload.email === 'string' ? payload.email.toLowerCase() : null,
    // Apple envoie parfois ce claim sous forme de texte ("true").
    emailVerified: payload.email_verified === true || payload.email_verified === 'true',
    name: typeof payload.name === 'string' && payload.name.trim() ? payload.name.trim().slice(0, 80) : null,
  };
}

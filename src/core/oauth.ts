/**
 * OAuth id_token verification (Sign in with Google).
 *
 * Mobile flow: the Expo app obtains a Google `id_token` natively and POSTs it to
 * /auth/oauth. We verify that token here — signature (against Google's public
 * keys), audience (one of our Client IDs), issuer and expiry — then trust the
 * identity it carries. No Google session is kept server-side; we mint our own
 * JWTs afterwards.
 */
import { OAuth2Client } from 'google-auth-library';
import { env } from '../config/env.js';
import { AppError } from './errors.js';

/** Identity extracted from a verified Google id_token. */
export interface GoogleIdentity {
  /** Stable Google subject id (maps to User.googleId). */
  googleId: string;
  email: string;
  /** Google asserts the email is verified. We require this. */
  emailVerified: boolean;
  /** Display name, if the user granted the profile scope. */
  name?: string;
  picture?: string;
}

// A single reusable client is enough; we pass the accepted audiences per call.
const client = new OAuth2Client();

/**
 * Verify a Google id_token and return the identity. Throws `OAUTH_INVALID`
 * (401) for any invalid/expired/wrong-audience token, and `SERVICE_UNAVAILABLE`
 * if Google sign-in isn't configured (no Client IDs set).
 */
export async function verifyGoogleIdToken(idToken: string): Promise<GoogleIdentity> {
  if (env.GOOGLE_CLIENT_IDS.length === 0) {
    throw new AppError('SERVICE_UNAVAILABLE', 'Google sign-in is not configured');
  }

  let payload;
  try {
    const ticket = await client.verifyIdToken({
      idToken,
      audience: env.GOOGLE_CLIENT_IDS, // accept any of our iOS/Android/Web client ids
    });
    payload = ticket.getPayload();
  } catch {
    // Bad signature, expired, wrong audience, malformed, etc.
    throw new AppError('OAUTH_INVALID', 'Invalid Google token');
  }

  if (!payload || !payload.sub || !payload.email) {
    throw new AppError('OAUTH_INVALID', 'Google token is missing required claims');
  }

  // Defence in depth: google-auth-library already checks iss, but assert it.
  const iss = payload.iss;
  if (iss !== 'accounts.google.com' && iss !== 'https://accounts.google.com') {
    throw new AppError('OAUTH_INVALID', 'Unexpected token issuer');
  }

  return {
    googleId: payload.sub,
    email: payload.email,
    emailVerified: payload.email_verified === true,
    name: payload.name,
    picture: payload.picture,
  };
}

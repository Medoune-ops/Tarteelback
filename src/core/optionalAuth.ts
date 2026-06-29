import type { FastifyRequest } from 'fastify';
import type { AccessClaims } from '../plugins/auth.js';

/**
 * Try to read a valid access token without failing if it's absent/invalid.
 * Used by endpoints that personalise output when logged in (e.g. node states),
 * but still work for anonymous callers.
 */
export async function tryAuth(req: FastifyRequest): Promise<AccessClaims | null> {
  const header = req.headers.authorization;
  if (!header) return null;
  try {
    const claims = await req.jwtVerify<AccessClaims>();
    req.auth = claims;
    return claims;
  } catch {
    return null;
  }
}

/** Resolve the desired content language: ?lang → Accept-Language → fallback. */
export function resolveLang(req: FastifyRequest, fallback: string): string {
  const q = (req.query as { lang?: string } | undefined)?.lang;
  if (q) return q.toLowerCase().slice(0, 5);
  const header = req.headers['accept-language'];
  if (header) {
    const first = header.split(',')[0]?.trim().split('-')[0];
    if (first) return first.toLowerCase();
  }
  return fallback;
}

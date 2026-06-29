import fp from 'fastify-plugin';
import fastifyJwt from '@fastify/jwt';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { env } from '../config/env.js';
import { AppError } from '../core/errors.js';

/** Claims carried by the short-lived access token. */
export interface AccessClaims {
  sub: string; // user id
  role: 'user' | 'admin';
}

declare module 'fastify' {
  interface FastifyInstance {
    /** Require a valid access token; attaches request.auth. */
    authenticate: (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
    /** Require an authenticated admin. */
    requireAdmin: (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
  interface FastifyRequest {
    auth?: AccessClaims;
  }
}

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: AccessClaims;
    user: AccessClaims;
  }
}

/**
 * Registers @fastify/jwt for ACCESS tokens only (refresh tokens are opaque and
 * handled in the auth service), plus `authenticate` / `requireAdmin` guards.
 */
export default fp(async (app) => {
  // Pin the algorithm (no alg-confusion) and set issuer/audience so tokens
  // minted for another service can't be replayed here.
  await app.register(fastifyJwt, {
    secret: env.JWT_ACCESS_SECRET,
    sign: { expiresIn: env.ACCESS_TOKEN_TTL, iss: 'tarteel', aud: 'tarteel-app' },
    verify: { algorithms: ['HS256'], allowedIss: 'tarteel', allowedAud: 'tarteel-app' },
  });

  app.decorate(
    'authenticate',
    async (req: FastifyRequest, _reply: FastifyReply) => {
      try {
        const claims = await req.jwtVerify<AccessClaims>();
        req.auth = claims;
      } catch (err) {
        const expired =
          err && typeof err === 'object' && 'code' in err &&
          (err as { code?: string }).code === 'FAST_JWT_EXPIRED';
        throw new AppError(
          expired ? 'TOKEN_EXPIRED' : 'UNAUTHENTICATED',
          expired ? 'Access token expired' : 'Invalid or missing access token',
        );
      }
    },
  );

  app.decorate('requireAdmin', async (req: FastifyRequest, reply: FastifyReply) => {
    await app.authenticate(req, reply);
    if (req.auth?.role !== 'admin') {
      throw new AppError('FORBIDDEN', 'Admin role required');
    }
  });
});

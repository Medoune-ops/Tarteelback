import fp from 'fastify-plugin';
import { createSigner, createVerifier, TokenError } from 'fast-jwt';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { AdminModule } from '@prisma/client';
import { env } from '../config/env.js';
import { AppError } from '../core/errors.js';
import { prisma } from '../config/prisma.js';

/** Claims carried by a back-office access token. */
export interface AdminAccessClaims {
  sub: string; // AdminUser id
  isOwner: boolean;
}

// A fully separate JWT signer/verifier for the back office — deliberately NOT
// @fastify/jwt's `namespace` option. Registering @fastify/jwt twice in the
// same (non-encapsulated) Fastify instance silently drops the second
// registration's request/reply decorators: the package is `fastify-plugin`-
// wrapped with a fixed `name: '@fastify/jwt'`, so avvio treats the second
// `app.register(fastifyJwt, {...})` as re-registering an already-loaded named
// plugin — `app.jwt.<namespace>` ends up populated but `request.<ns>JwtVerify`
// never gets attached (confirmed against @fastify/jwt 10.1.0's source; see git
// history/PR discussion for the reproduction). Signing/verifying by hand with
// `fast-jwt` (the library @fastify/jwt itself delegates to) sidesteps the
// whole registration-dedup problem and needs no plugin registration at all.
//
// Isolation this buys us, same as the mobile token: different secret,
// different `aud`, different payload shape. A token minted for one audience
// can never verify against the other, even replayed on the wrong host.
declare module 'fastify' {
  interface FastifyInstance {
    /** Sign a back-office access token. */
    signAdminAccessToken: (claims: AdminAccessClaims) => string;
    /** Require a valid back-office access token; attaches request.adminAuth. */
    authenticateAdmin: (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
    /** Require an authenticated back-office *owner* (invite/reset-password/permissions). */
    requireAdminOwner: (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
    /**
     * Require authentication AND at least `level` permission on `module` for
     * the caller (owners always pass — see AdminUser.isOwner, which bypasses
     * per-module grants by design, same as requireAdminOwner). Use as a route
     * `preHandler` alongside/instead of authenticateAdmin.
     */
    requireAdminPermission: (
      module: AdminModule,
      level: 'view' | 'edit',
    ) => (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
  interface FastifyRequest {
    adminAuth?: AdminAccessClaims;
  }
}

const ISSUER = 'tarteel';
const AUDIENCE = 'tarteel-backoffice';

export default fp(async (app) => {
  const sign = createSigner({
    key: env.JWT_ADMIN_ACCESS_SECRET,
    algorithm: 'HS256',
    iss: ISSUER,
    aud: AUDIENCE,
    // fast-jwt accepts a "15m"-style duration string directly (same format
    // ACCESS_TOKEN_TTL already uses for the mobile token).
    expiresIn: env.ADMIN_ACCESS_TOKEN_TTL,
  });

  const verify = createVerifier({
    key: env.JWT_ADMIN_ACCESS_SECRET,
    algorithms: ['HS256'],
    allowedIss: ISSUER,
    allowedAud: AUDIENCE,
  });

  app.decorate('signAdminAccessToken', (claims: AdminAccessClaims) => sign(claims));

  app.decorate(
    'authenticateAdmin',
    async (req: FastifyRequest, _reply: FastifyReply) => {
      const header = req.headers.authorization;
      if (!header || !/^Bearer\s/i.test(header)) {
        throw new AppError('UNAUTHENTICATED', 'Invalid or missing admin access token');
      }
      const token = header.slice(header.indexOf(' ') + 1).trim();

      try {
        req.adminAuth = (await verify(token)) as AdminAccessClaims;
      } catch (err) {
        const expired = err instanceof TokenError && err.code === TokenError.codes.expired;
        throw new AppError(
          expired ? 'TOKEN_EXPIRED' : 'UNAUTHENTICATED',
          expired ? 'Admin access token expired' : 'Invalid or missing admin access token',
        );
      }
    },
  );

  app.decorate('requireAdminOwner', async (req: FastifyRequest, reply: FastifyReply) => {
    await app.authenticateAdmin(req, reply);
    if (!req.adminAuth?.isOwner) {
      throw new AppError('FORBIDDEN', 'Owner privileges required');
    }
  });

  app.decorate(
    'requireAdminPermission',
    (module: AdminModule, level: 'view' | 'edit') =>
      async (req: FastifyRequest, reply: FastifyReply) => {
        await app.authenticateAdmin(req, reply);
        // Owners bypass per-module grants entirely — same rule as
        // requireAdminOwner, and consistent with AdminUser.isOwner meaning
        // "unrestricted", not "has every AdminPermission row".
        if (req.adminAuth!.isOwner) return;

        const perm = await prisma.adminPermission.findUnique({
          where: { adminUserId_module: { adminUserId: req.adminAuth!.sub, module } },
        });
        const allowed = level === 'view' ? (perm?.canView ?? false) : (perm?.canEdit ?? false);
        if (!allowed) {
          throw new AppError('FORBIDDEN', `Missing '${level}' permission on module '${module}'`);
        }
      },
  );
});

import type { FastifyInstance } from 'fastify';
import { isTest } from '../../config/env.js';
import { adminAuthController } from './adminAuth.controller.js';

/**
 * Back-office authentication, team management (invite / reset password /
 * permissions) and activity log. Mirrors modules/auth/auth.routes.ts, but:
 *  - /login, /refresh, /logout are open (that's how you get a session);
 *  - /change-password requires only being authenticated (any member can
 *    change their OWN password, current password required — self-service);
 *  - team management (/team/invite, /team/:id/password, /team/:id/permissions,
 *    /activity-log) additionally requires the owner flag (app.requireAdminOwner)
 *    — an invited member can use the back-office but can't invite anyone,
 *    reset someone else's password, or see the activity log.
 */
export async function adminAuthRoutes(app: FastifyInstance) {
  const authLimit = {
    config: { rateLimit: { max: isTest ? 100_000 : 20, timeWindow: '1 minute' } },
  };

  app.post(
    '/login',
    { ...authLimit, schema: { tags: ['backoffice'], summary: 'Sign in to the back office' } },
    adminAuthController.login,
  );

  app.post(
    '/refresh',
    { ...authLimit, schema: { tags: ['backoffice'], summary: 'Rotate the back-office refresh token' } },
    adminAuthController.refresh,
  );

  app.post(
    '/logout',
    { schema: { tags: ['backoffice'], summary: 'Revoke the current back-office session (or all)' } },
    adminAuthController.logout,
  );

  const sec = { tags: ['backoffice'] as const, security: [{ bearerAuth: [] }] };

  app.post(
    '/change-password',
    { preHandler: app.authenticateAdmin, schema: { ...sec, summary: 'Change your own password (current password required)' } },
    adminAuthController.changePassword,
  );

  app.get(
    '/team',
    { preHandler: app.authenticateAdmin, schema: { ...sec, summary: 'List back-office members and their permissions' } },
    adminAuthController.listTeam,
  );

  app.post(
    '/team/invite',
    { preHandler: app.requireAdminOwner, schema: { ...sec, summary: 'Create a member (owner picks email + password + permissions)' } },
    adminAuthController.invite,
  );

  app.patch(
    '/team/:id/password',
    { preHandler: app.requireAdminOwner, schema: { ...sec, summary: "Reset a member's password (owner only, no current password needed)" } },
    adminAuthController.setPassword,
  );

  app.patch(
    '/team/:id/permissions',
    { preHandler: app.requireAdminOwner, schema: { ...sec, summary: "Update a member's module permissions" } },
    adminAuthController.updatePermissions,
  );

  app.get(
    '/activity-log',
    { preHandler: app.requireAdminOwner, schema: { ...sec, summary: "Team activity log (logins, actions) — owner only" } },
    adminAuthController.listActivity,
  );
}

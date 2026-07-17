import type { FastifyInstance } from 'fastify';
import { adminUsersController } from './adminUsers.controller.js';

/**
 * Back-office user management: list/search/filter, ban/unban, and grant
 * hearts/gems/premium. Every route requires an authenticated back-office
 * member (app.authenticateAdmin) — see plugins/adminAuth.ts. Fine-grained
 * per-module view/edit permissions (AdminPermission) are not yet enforced
 * here at the route layer; only session validity is checked for now.
 */
export async function adminUsersRoutes(app: FastifyInstance) {
  app.addHook('preHandler', app.authenticateAdmin);

  const sec = { tags: ['backoffice'] as const, security: [{ bearerAuth: [] }] };

  app.get('/', { schema: { ...sec, summary: 'List/search/filter users' } }, adminUsersController.list);

  app.post('/:id/ban', { schema: { ...sec, summary: 'Ban a user (revokes their sessions)' } }, adminUsersController.ban);
  app.post('/:id/unban', { schema: { ...sec, summary: 'Lift a ban' } }, adminUsersController.unban);

  app.post('/:id/grant-hearts', { schema: { ...sec, summary: 'Grant hearts (capped at MAX_HEARTS)' } }, adminUsersController.grantHearts);
  app.post('/:id/grant-gems', { schema: { ...sec, summary: 'Grant gems (ledgered)' } }, adminUsersController.grantGems);
  app.post('/:id/grant-premium', { schema: { ...sec, summary: 'Grant Premium for N days or lifetime' } }, adminUsersController.grantPremium);
}

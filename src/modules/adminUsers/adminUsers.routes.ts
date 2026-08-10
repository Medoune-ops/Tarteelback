import type { FastifyInstance } from 'fastify';
import { adminUsersController } from './adminUsers.controller.js';

/**
 * Back-office user management: list/search/filter, ban/unban, and grant
 * hearts/gems/premium. Every route requires an authenticated back-office
 * member with at least 'view' (read) or 'edit' (mutating) permission on the
 * 'users' module — see plugins/adminAuth.ts::requireAdminPermission. Owners
 * bypass this check entirely (unrestricted by design).
 */
export async function adminUsersRoutes(app: FastifyInstance) {
  const sec = { tags: ['backoffice'] as const, security: [{ bearerAuth: [] }] };
  const view = app.requireAdminPermission('users', 'view');
  const edit = app.requireAdminPermission('users', 'edit');

  app.get('/', { preHandler: view, schema: { ...sec, summary: 'List/search/filter users' } }, adminUsersController.list);

  app.post('/:id/ban', { preHandler: edit, schema: { ...sec, summary: 'Ban a user (revokes their sessions)' } }, adminUsersController.ban);
  app.post('/:id/unban', { preHandler: edit, schema: { ...sec, summary: 'Lift a ban' } }, adminUsersController.unban);

  app.post('/:id/grant-hearts', { preHandler: edit, schema: { ...sec, summary: 'Grant hearts (capped at MAX_HEARTS)' } }, adminUsersController.grantHearts);
  app.post('/:id/grant-gems', { preHandler: edit, schema: { ...sec, summary: 'Grant gems (ledgered)' } }, adminUsersController.grantGems);
  app.post('/:id/grant-premium', { preHandler: edit, schema: { ...sec, summary: 'Grant Premium for N days or lifetime' } }, adminUsersController.grantPremium);
  app.post('/:id/revoke-granted-premium', { preHandler: edit, schema: { ...sec, summary: 'Revoke Premium — no-op if the user actually paid for it' } }, adminUsersController.revokeGrantedPremium);
}

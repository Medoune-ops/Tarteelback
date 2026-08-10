import type { FastifyInstance } from 'fastify';
import { adminGiftsController } from './adminGifts.controller.js';

/**
 * Back-office bulk gifting: grant hearts/gems/premium to a whole segment
 * (all/premium/free/banned) or an explicit list of user ids in one call.
 * Requires 'edit' permission on the 'users' module (mutates User rows in bulk).
 */
export async function adminGiftsRoutes(app: FastifyInstance) {
  const sec = { tags: ['backoffice'] as const, security: [{ bearerAuth: [] }] };
  const edit = app.requireAdminPermission('users', 'edit');

  app.post('/bulk-grant', { preHandler: edit, schema: { ...sec, summary: 'Grant hearts/gems/premium to a segment or a list of users' } }, adminGiftsController.bulkGrant);
}

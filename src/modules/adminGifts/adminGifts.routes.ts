import type { FastifyInstance } from 'fastify';
import { adminGiftsController } from './adminGifts.controller.js';

/**
 * Back-office bulk gifting: grant hearts/gems/premium to a whole segment
 * (all/premium/free/banned) or an explicit list of user ids in one call.
 * Requires an authenticated back-office member (app.authenticateAdmin).
 */
export async function adminGiftsRoutes(app: FastifyInstance) {
  app.addHook('preHandler', app.authenticateAdmin);

  const sec = { tags: ['backoffice'] as const, security: [{ bearerAuth: [] }] };

  app.post('/bulk-grant', { schema: { ...sec, summary: 'Grant hearts/gems/premium to a segment or a list of users' } }, adminGiftsController.bulkGrant);
}

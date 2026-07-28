import type { FastifyInstance } from 'fastify';
import { adminNotificationsController } from './adminNotifications.controller.js';

/**
 * Back-office announcement composer: broadcasts a real Expo push notification
 * to a whole audience segment (all/premium/free) and keeps a persisted send
 * history (backed by AdminActivityLog), instead of a client-only simulation.
 * Requires an authenticated back-office member (app.authenticateAdmin).
 */
export async function adminNotificationsRoutes(app: FastifyInstance) {
  app.addHook('preHandler', app.authenticateAdmin);

  const sec = { tags: ['backoffice'] as const, security: [{ bearerAuth: [] }] };

  app.post('/broadcast', { schema: { ...sec, summary: 'Broadcast a push notification to an audience segment' } }, adminNotificationsController.broadcast);
  app.get('/history', { schema: { ...sec, summary: 'List recent broadcast announcements' } }, adminNotificationsController.history);
}

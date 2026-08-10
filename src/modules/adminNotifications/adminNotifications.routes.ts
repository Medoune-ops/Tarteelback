import type { FastifyInstance } from 'fastify';
import { adminNotificationsController } from './adminNotifications.controller.js';

/**
 * Back-office announcement composer: broadcasts a real Expo push notification
 * to a whole audience segment (all/premium/free) and keeps a persisted send
 * history (backed by AdminActivityLog), instead of a client-only simulation.
 * Requires 'view' (history) or 'edit' (broadcast) on the 'push_announcements' module.
 */
export async function adminNotificationsRoutes(app: FastifyInstance) {
  const sec = { tags: ['backoffice'] as const, security: [{ bearerAuth: [] }] };
  const view = app.requireAdminPermission('push_announcements', 'view');
  const edit = app.requireAdminPermission('push_announcements', 'edit');

  app.post('/broadcast', { preHandler: edit, schema: { ...sec, summary: 'Broadcast a push notification to an audience segment' } }, adminNotificationsController.broadcast);
  app.get('/history', { preHandler: view, schema: { ...sec, summary: 'List recent broadcast announcements' } }, adminNotificationsController.history);
}

import type { FastifyInstance } from 'fastify';
import { notificationController } from './notification.controller.js';

/** Push-notification routes. All require auth (scoped to the token owner). */
export async function notificationRoutes(app: FastifyInstance) {
  app.addHook('preHandler', app.authenticate);
  const sec = { tags: ['notifications'] as const, security: [{ bearerAuth: [] }] };

  app.post('/tokens', { schema: { ...sec, summary: 'Register an Expo push token for this device' } }, notificationController.registerToken);
  app.delete('/tokens', { schema: { ...sec, summary: 'Remove an Expo push token' } }, notificationController.removeToken);
  app.get('/preferences', { schema: { ...sec, summary: 'Get notification preferences' } }, notificationController.getPrefs);
  app.patch('/preferences', { schema: { ...sec, summary: 'Update notification preferences' } }, notificationController.updatePrefs);
}

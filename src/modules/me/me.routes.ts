import type { FastifyInstance } from 'fastify';
import { meController } from './me.controller.js';

/** Current-user routes. All require a valid access token. */
export async function meRoutes(app: FastifyInstance) {
  app.addHook('preHandler', app.authenticate);

  const sec = { security: [{ bearerAuth: [] }] };

  app.get('/', { schema: { tags: ['me'], summary: 'Get current user', ...sec } }, meController.get);
  app.patch('/', { schema: { tags: ['me'], summary: 'Update profile', ...sec } }, meController.update);
  app.patch(
    '/settings',
    { schema: { tags: ['me'], summary: 'Update app settings (voice, language)', ...sec } },
    meController.updateSettings,
  );
  app.get(
    '/activity',
    { schema: { tags: ['me'], summary: 'Active days for a month (calendar)', ...sec } },
    meController.activity,
  );

  app.post(
    '/hearts/sync',
    { schema: { tags: ['me'], summary: 'Recompute & return hearts', ...sec } },
    meController.syncHearts,
  );
  app.post(
    '/streak/refresh',
    { schema: { tags: ['me'], summary: 'Recompute & return streak', ...sec } },
    meController.refreshStreak,
  );
}

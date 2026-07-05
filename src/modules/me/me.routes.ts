import type { FastifyInstance } from 'fastify';
import { isTest } from '../../config/env.js';
import { meController } from './me.controller.js';

/** Current-user routes. All require a valid access token. */
export async function meRoutes(app: FastifyInstance) {
  app.addHook('preHandler', app.authenticate);

  const sec = { security: [{ bearerAuth: [] }] };

  app.get('/', { schema: { tags: ['me'], summary: 'Get current user', ...sec } }, meController.get);
  app.patch('/', { schema: { tags: ['me'], summary: 'Update profile', ...sec } }, meController.update);
  app.delete(
    '/',
    {
      // Limite serrée : l'endpoint vérifie un mot de passe → ne pas en faire
      // un oracle de brute force (5 essais/min par IP).
      config: { rateLimit: { max: isTest ? 100_000 : 5, timeWindow: '1 minute' } },
      schema: { tags: ['me'], summary: 'Delete account permanently (requires password)', ...sec },
    },
    meController.deleteAccount,
  );
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
  app.get(
    '/sourates',
    { schema: { tags: ['me'], summary: 'Surahs learned in full (section lessons completed)', ...sec } },
    meController.sourates,
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

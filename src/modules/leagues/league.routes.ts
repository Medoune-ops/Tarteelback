import type { FastifyInstance } from 'fastify';
import { leagueController } from './league.controller.js';

export async function leagueRoutes(app: FastifyInstance) {
  app.addHook('preHandler', app.authenticate);
  const sec = { tags: ['leagues'] as const, security: [{ bearerAuth: [] }] };

  app.post('/join', { schema: { ...sec, summary: 'Join the current league week' } }, leagueController.join);
  app.get('/me', { schema: { ...sec, summary: 'My league ranking view' } }, leagueController.me);
  app.get('/', { schema: { ...sec, summary: 'List league tiers' } }, leagueController.list);
}

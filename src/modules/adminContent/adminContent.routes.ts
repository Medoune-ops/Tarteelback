import type { FastifyInstance } from 'fastify';
import { adminContentController } from './adminContent.controller.js';

/**
 * Back-office content overview: one row per Section with lesson count,
 * completion %, active learners, and a published/draft toggle. Every route
 * requires an authenticated back-office member (app.authenticateAdmin).
 */
export async function adminContentRoutes(app: FastifyInstance) {
  app.addHook('preHandler', app.authenticateAdmin);

  const sec = { tags: ['backoffice'] as const, security: [{ bearerAuth: [] }] };

  app.get('/', { schema: { ...sec, summary: 'List sections with lesson/completion stats' } }, adminContentController.list);
  app.get('/summary', { schema: { ...sec, summary: 'Global content KPIs (sourates, leçons, complétion, brouillons)' } }, adminContentController.summary);
  app.patch('/:id/published', { schema: { ...sec, summary: 'Toggle a section published/draft' } }, adminContentController.setPublished);
}

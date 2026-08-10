import type { FastifyInstance } from 'fastify';
import { adminContentController } from './adminContent.controller.js';

/**
 * Back-office content overview: one row per Section with lesson count,
 * completion %, active learners, and a published/draft toggle. Requires at
 * least 'view' (read) or 'edit' (mutating) permission on the 'content' module.
 */
export async function adminContentRoutes(app: FastifyInstance) {
  const sec = { tags: ['backoffice'] as const, security: [{ bearerAuth: [] }] };
  const view = app.requireAdminPermission('content', 'view');
  const edit = app.requireAdminPermission('content', 'edit');

  app.get('/', { preHandler: view, schema: { ...sec, summary: 'List sections with lesson/completion stats' } }, adminContentController.list);
  app.get('/summary', { preHandler: view, schema: { ...sec, summary: 'Global content KPIs (sourates, leçons, complétion, brouillons)' } }, adminContentController.summary);
  app.patch('/:id/published', { preHandler: edit, schema: { ...sec, summary: 'Toggle a section published/draft' } }, adminContentController.setPublished);
}

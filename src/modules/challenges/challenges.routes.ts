import type { FastifyInstance } from 'fastify';
import { challengesController } from './challenges.controller.js';

export async function challengeRoutes(app: FastifyInstance) {
  app.addHook('preHandler', app.authenticate);
  const sec = { tags: ['challenges'] as const, security: [{ bearerAuth: [] }] };

  app.post('/preview', { schema: { ...sec, summary: 'Aperçu d\u2019un défi (sans création)' } }, (req, reply) =>
    challengesController.preview(req, reply),
  );
  app.post('/', { schema: { ...sec, summary: 'Créer un défi' } }, (req, reply) =>
    challengesController.create(req, reply),
  );
  app.get('/', { schema: { ...sec, summary: 'Lister mes défis' } }, (req, reply) =>
    challengesController.list(req, reply),
  );
  app.get('/:id', { schema: { ...sec, summary: 'Détail d\u2019un défi' } }, (req, reply) =>
    challengesController.get(req, reply),
  );
  app.post('/:id/nudge', { schema: { ...sec, summary: 'Relancer un participant' } }, (req, reply) =>
    challengesController.nudge(req, reply),
  );
}

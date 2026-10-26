import type { FastifyInstance } from 'fastify';
import { friendsGate } from '../friends/friends.gate.js';
import { challengesController } from './challenges.controller.js';

export async function challengeRoutes(app: FastifyInstance) {
  app.addHook('preHandler', app.authenticate);
  app.addHook('preHandler', friendsGate);
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
  app.post('/:id/accept', { schema: { ...sec, summary: 'Accepter une invitation (avant le début)' } }, (req, reply) =>
    challengesController.accept(req, reply),
  );
  app.post('/:id/decline', { schema: { ...sec, summary: 'Refuser une invitation' } }, (req, reply) =>
    challengesController.decline(req, reply),
  );
  app.post('/:id/leave', { schema: { ...sec, summary: 'Quitter un défi' } }, (req, reply) =>
    challengesController.leave(req, reply),
  );
  app.post('/:id/cancel', { schema: { ...sec, summary: 'Annuler un défi (créateur, avant le début)' } }, (req, reply) =>
    challengesController.cancel(req, reply),
  );
  app.post('/:id/nudge', { schema: { ...sec, summary: 'Relancer un participant' } }, (req, reply) =>
    challengesController.nudge(req, reply),
  );
}

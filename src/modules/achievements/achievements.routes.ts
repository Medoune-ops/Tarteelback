import type { FastifyInstance } from 'fastify';
import { friendsGate } from '../friends/friends.gate.js';
import { achievementsController } from './achievements.controller.js';

export async function achievementsRoutes(app: FastifyInstance) {
  app.addHook('preHandler', app.authenticate);
  app.addHook('preHandler', friendsGate);
  const sec = { tags: ['achievements'] as const, security: [{ bearerAuth: [] }] };

  app.get(
    '/',
    { schema: { ...sec, summary: 'Lister mes réussites' } },
    (req, reply) => achievementsController.list(req, reply),
  );
  app.get(
    '/feed',
    { schema: { ...sec, summary: 'Fil d\'activité des réussites des amis' } },
    (req, reply) => achievementsController.feed(req, reply),
  );
  app.put(
    '/:id/reaction',
    { schema: { ...sec, summary: 'Réagir à une réussite' } },
    (req, reply) => achievementsController.react(req, reply),
  );
  app.delete(
    '/:id/reaction',
    { schema: { ...sec, summary: 'Retirer sa réaction' } },
    (req, reply) => achievementsController.unreact(req, reply),
  );
}

import type { FastifyInstance } from 'fastify';
import { friendsController } from './friends.controller.js';

export async function reportRoutes(app: FastifyInstance) {
  app.addHook('preHandler', app.authenticate);
  const sec = { tags: ['friends'] as const, security: [{ bearerAuth: [] }] };

  app.post('/reports', { schema: { ...sec, summary: 'Signaler un utilisateur/contenu' } }, (req, reply) =>
    friendsController.createReport(req, reply),
  );
}

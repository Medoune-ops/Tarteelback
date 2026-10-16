import type { FastifyInstance } from 'fastify';
import { friendsController } from './friends.controller.js';

export async function blockRoutes(app: FastifyInstance) {
  app.addHook('preHandler', app.authenticate);
  const sec = { tags: ['friends'] as const, security: [{ bearerAuth: [] }] };

  app.get('/blocks', { schema: { ...sec, summary: 'Liste des utilisateurs bloqués' } }, (req, reply) =>
    friendsController.listBlocks(req, reply),
  );
  app.post('/blocks/:userId', { schema: { ...sec, summary: 'Bloquer un utilisateur' } }, (req, reply) =>
    friendsController.block(req, reply),
  );
  app.delete('/blocks/:userId', { schema: { ...sec, summary: 'Débloquer un utilisateur' } }, (req, reply) =>
    friendsController.unblock(req, reply),
  );
}

import type { FastifyInstance } from 'fastify';
import { friendsGate } from '../friends/friends.gate.js';
import { messagesController } from './messages.controller.js';

export async function messagesRoutes(app: FastifyInstance) {
  app.addHook('preHandler', app.authenticate);
  app.addHook('preHandler', friendsGate);
  const sec = { tags: ['messages'] as const, security: [{ bearerAuth: [] }] };

  app.post(
    '/',
    { schema: { ...sec, summary: 'Envoyer un message à des amis' } },
    (req, reply) => messagesController.send(req, reply),
  );
  app.get(
    '/',
    { schema: { ...sec, summary: 'Lister mes messages reçus' } },
    (req, reply) => messagesController.list(req, reply),
  );
  app.post(
    '/:id/read',
    { schema: { ...sec, summary: 'Marquer un message comme lu' } },
    (req, reply) => messagesController.read(req, reply),
  );
  app.delete(
    '/:id',
    { schema: { ...sec, summary: 'Masquer un message (destinataire seulement)' } },
    (req, reply) => messagesController.remove(req, reply),
  );
}

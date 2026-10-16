import type { FastifyInstance } from 'fastify';
import { friendsController } from './friends.controller.js';

export async function friendsRoutes(app: FastifyInstance) {
  app.addHook('preHandler', app.authenticate);
  const sec = { tags: ['friends'] as const, security: [{ bearerAuth: [] }] };

  app.get('/', { schema: { ...sec, summary: 'Liste des amis (curseur, racine)' } }, (req, reply) =>
    friendsController.listFriends(req, reply),
  );

  app.post('/requests', { schema: { ...sec, summary: 'Envoyer une demande par code' } }, (req, reply) =>
    friendsController.sendRequest(req, reply),
  );
  app.get('/requests', { schema: { ...sec, summary: 'Demandes reçues et envoyées' } }, (req, reply) =>
    friendsController.listRequests(req, reply),
  );
  app.post('/requests/:id/accept', { schema: { ...sec, summary: 'Accepter une demande' } }, (req, reply) =>
    friendsController.accept(req, reply),
  );
  app.post('/requests/:id/decline', { schema: { ...sec, summary: 'Refuser une demande' } }, (req, reply) =>
    friendsController.decline(req, reply),
  );
  app.delete('/requests/:id', { schema: { ...sec, summary: 'Annuler une demande envoyée' } }, (req, reply) =>
    friendsController.cancel(req, reply),
  );
  app.delete('/:userId', { schema: { ...sec, summary: 'Retirer un ami' } }, (req, reply) =>
    friendsController.removeFriend(req, reply),
  );
}

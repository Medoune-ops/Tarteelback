import type { FastifyInstance } from 'fastify';
import { friendsController } from './friends.controller.js';
import { friendsService } from './friends.service.js';

export async function friendsRoutes(app: FastifyInstance) {
  app.addHook('preHandler', app.authenticate);
  const sec = { tags: ['friends'] as const, security: [{ bearerAuth: [] }] };

  app.get('/', { schema: { ...sec, summary: 'Liste des amis (curseur)' } }, (req, reply) =>
    friendsController.listFriends(req, reply),
  );

  app.get('/settings', { schema: { ...sec, summary: 'Paramètres amis' } }, (req, reply) =>
    friendsController.getSettings(req, reply),
  );
  app.patch('/settings', { schema: { ...sec, summary: 'Mettre à jour les paramètres amis' } }, (req, reply) =>
    friendsController.updateSettings(req, reply),
  );

  app.get('/leaderboard', { schema: { ...sec, summary: 'Classement amis de la semaine' } }, (req, reply) =>
    friendsController.leaderboard(req, reply),
  );
  app.get('/summary', { schema: { ...sec, summary: 'Compteurs amis' } }, (req, reply) =>
    friendsController.summary(req, reply),
  );

  app.get('/requests', { schema: { ...sec, summary: 'Demandes reçues et envoyées' } }, (req, reply) =>
    friendsController.listRequests(req, reply),
  );
  app.post('/requests', { schema: { ...sec, summary: 'Envoyer une demande par code' } }, (req, reply) =>
    friendsController.sendRequest(req, reply),
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

  app.post('/invites/qr', { schema: { ...sec, summary: 'Créer une invitation QR' } }, async (req, reply) => {
    const result = await friendsService.createQrInvite(req.auth!.sub);
    return reply.status(201).send(result);
  });
  app.post('/invites/link', { schema: { ...sec, summary: 'Créer ou récupérer un lien' } }, async (req, reply) => {
    const result = await friendsService.createLinkInvite(req.auth!.sub);
    return reply.status(201).send(result);
  });
  app.get('/invites/:token', { schema: { ...sec, summary: 'Prévisualiser une invitation' } }, async (req, reply) => {
    const token = (req.params as { token: string }).token;
    const result = await friendsService.previewInvite(token);
    return reply.send(result);
  });
  app.post('/invites/:token/accept', { schema: { ...sec, summary: 'Accepter une invitation' } }, async (req, reply) => {
    const token = (req.params as { token: string }).token;
    const result = await friendsService.acceptInvite(req.auth!.sub, token);
    return reply.send(result);
  });

  app.delete('/:userId', { schema: { ...sec, summary: 'Retirer un ami' } }, (req, reply) =>
    friendsController.removeFriend(req, reply),
  );
  app.get('/:userId', { schema: { ...sec, summary: "Profil d'un ami" } }, (req, reply) =>
    friendsController.getFriendProfile(req, reply),
  );
}

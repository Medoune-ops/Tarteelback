import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { friendsController } from './friends.controller.js';
import { requireFriendsEnabled } from './friends.guard.js';

/**
 * Amis — monté sous /me/friends. Fonctionnalité derrière le flag serveur
 * FRIENDS_ENABLED : quand il est faux, toutes les routes renvoient 404 comme
 * si elles n'existaient pas.
 *
 * Amitié IMMÉDIATE à l'ajout par code (saisi) ou par QR (même route, le QR
 * encode simplement le code). Quota serveur : 3 envois/jour (phase 4).
 */
export async function friendsRoutes(app: FastifyInstance) {
  app.addHook('preHandler', async (req: FastifyRequest, reply: FastifyReply) => {
    // Flag d'abord : on masque la fonctionnalité (404) avant même l'auth.
    requireFriendsEnabled();
    await app.authenticate(req, reply);
  });

  const sec = { tags: ['friends'] as const, security: [{ bearerAuth: [] }] };

  app.get('/code', { schema: { ...sec, summary: 'Mon code / lien de partage ami' } }, friendsController.getCode);
  app.post('/code/regenerate', { schema: { ...sec, summary: 'Régénérer mon code de partage' } }, friendsController.regenerateCode);

  app.get('/', { schema: { ...sec, summary: 'Lister mes amis' } }, friendsController.list);
  app.post('/add', { schema: { ...sec, summary: 'Ajouter un ami par code (ou QR)' } }, friendsController.add);
  app.get('/:userId/progress', { schema: { ...sec, summary: "Progrès d'un ami" } }, friendsController.progress);
  app.delete('/:id', { schema: { ...sec, summary: 'Retirer une amitié' } }, friendsController.remove);

  app.post('/:userId/block', { schema: { ...sec, summary: 'Bloquer un utilisateur' } }, friendsController.block);
  app.delete('/:userId/block', { schema: { ...sec, summary: 'Débloquer un utilisateur' } }, friendsController.unblock);
  app.post('/report', { schema: { ...sec, summary: 'Signaler un utilisateur' } }, friendsController.report);

  // Phase 2 — classement hebdomadaire & fil d'activité.
  app.get('/leaderboard', { schema: { ...sec, summary: 'Classement de la semaine (moi + amis)' } }, friendsController.leaderboard);
  app.get('/activity', { schema: { ...sec, summary: 'Fil des réussites de mes amis' } }, friendsController.activity);
  app.post('/activity/:activityId/cheer', { schema: { ...sec, summary: 'Réagir « bravo » à une réussite' } }, friendsController.cheer);

  // Phase 3 — défis partagés.
  app.get('/challenges', { schema: { ...sec, summary: 'Mes défis' } }, friendsController.listChallenges);
  app.post('/challenges', { schema: { ...sec, summary: 'Créer un défi partagé' } }, friendsController.createChallenge);
  app.get('/challenges/:challengeId', { schema: { ...sec, summary: "Détail d'un défi" } }, friendsController.getChallenge);
  app.delete('/challenges/:challengeId', { schema: { ...sec, summary: 'Quitter un défi (définitif)' } }, friendsController.leaveChallenge);

  // Phase 4 — envois « à un ami » & boîte de réception.
  app.get('/inbox', { schema: { ...sec, summary: 'Ma boîte de réception amis' } }, friendsController.inbox);
  app.get('/send-quota', { schema: { ...sec, summary: "Quota d'envoi du jour" } }, friendsController.sendQuota);
  app.post('/inbox/:messageId/read', { schema: { ...sec, summary: 'Marquer un message comme lu' } }, friendsController.markMessageRead);
  app.post('/:userId/send', { schema: { ...sec, summary: 'Envoyer un message à un ami' } }, friendsController.send);
}

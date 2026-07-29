import type { FastifyInstance } from 'fastify';
import { adminSupportController } from './adminSupport.controller.js';

/**
 * Back-office: conversations support (réclamations/suggestions) envoyées
 * depuis Paramètres → Support. Une ligne par utilisateur (boîte de
 * réception) ; l'admin peut lire le fil complet et y répondre — la réponse
 * est visible dans l'app ET déclenche une notification push à l'utilisateur.
 * Requiert un membre back-office authentifié (app.authenticateAdmin).
 */
export async function adminSupportRoutes(app: FastifyInstance) {
  app.addHook('preHandler', app.authenticateAdmin);

  const sec = { tags: ['backoffice'] as const, security: [{ bearerAuth: [] }] };

  app.get(
    '/messages',
    { schema: { ...sec, summary: 'Liste paginée des conversations support (recherche + filtre statut)' } },
    adminSupportController.list,
  );

  app.get(
    '/summary',
    { schema: { ...sec, summary: 'Compteurs support : non lus, total, reçus dans les dernières 24h' } },
    adminSupportController.summary,
  );

  app.get(
    '/messages/:userId/thread',
    { schema: { ...sec, summary: 'Fil complet de la conversation support avec un utilisateur' } },
    adminSupportController.thread,
  );

  app.post(
    '/messages/:userId/reply',
    { schema: { ...sec, summary: 'Répondre dans le fil support d\'un utilisateur (visible dans l\'app + push)' } },
    adminSupportController.reply,
  );
}

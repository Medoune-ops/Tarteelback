import type { FastifyInstance } from 'fastify';
import { adminSupportController } from './adminSupport.controller.js';

/**
 * Back-office: conversations support (réclamations/suggestions) envoyées
 * depuis Paramètres → Support. Une ligne par utilisateur (boîte de
 * réception) ; l'admin peut lire le fil complet et y répondre — la réponse
 * est visible dans l'app ET déclenche une notification push à l'utilisateur.
 * Pas de module AdminModule dédié ('support' n'existe pas dans l'enum) : ces
 * routes agissent sur des données utilisateur, donc rattachées au module 'users'.
 */
export async function adminSupportRoutes(app: FastifyInstance) {
  const sec = { tags: ['backoffice'] as const, security: [{ bearerAuth: [] }] };
  const view = app.requireAdminPermission('users', 'view');
  const edit = app.requireAdminPermission('users', 'edit');

  app.get(
    '/messages',
    { preHandler: view, schema: { ...sec, summary: 'Liste paginée des conversations support (recherche + filtre statut)' } },
    adminSupportController.list,
  );

  app.get(
    '/summary',
    { preHandler: view, schema: { ...sec, summary: 'Compteurs support : non lus, total, reçus dans les dernières 24h' } },
    adminSupportController.summary,
  );

  app.get(
    '/messages/:userId/thread',
    { preHandler: view, schema: { ...sec, summary: 'Fil complet de la conversation support avec un utilisateur' } },
    adminSupportController.thread,
  );

  app.post(
    '/messages/:userId/reply',
    { preHandler: edit, schema: { ...sec, summary: 'Répondre dans le fil support d\'un utilisateur (visible dans l\'app + push)' } },
    adminSupportController.reply,
  );
}

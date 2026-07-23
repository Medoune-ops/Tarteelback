import type { FastifyInstance } from 'fastify';
import { adminSupportController } from './adminSupport.controller.js';

/**
 * Back-office: messages support (réclamations/suggestions) envoyés depuis
 * Paramètres → Support. Statut lu/non lu basculable, pas d'autre workflow —
 * l'admin répond hors système (mailto:, voir support.html côté back-office).
 * Requiert un membre back-office authentifié (app.authenticateAdmin).
 */
export async function adminSupportRoutes(app: FastifyInstance) {
  app.addHook('preHandler', app.authenticateAdmin);

  const sec = { tags: ['backoffice'] as const, security: [{ bearerAuth: [] }] };

  app.get(
    '/messages',
    { schema: { ...sec, summary: 'Liste paginée des messages support (recherche + filtre statut)' } },
    adminSupportController.list,
  );

  app.get(
    '/summary',
    { schema: { ...sec, summary: 'Compteurs support : non lus, total, reçus dans les dernières 24h' } },
    adminSupportController.summary,
  );

  app.post(
    '/messages/:id/read',
    { schema: { ...sec, summary: 'Bascule le statut lu/non lu d\'un message support' } },
    adminSupportController.toggleRead,
  );
}

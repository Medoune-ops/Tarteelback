import type { FastifyInstance } from 'fastify';
import { supportController } from './support.controller.js';

/**
 * Support — Paramètres → Support côté app. Conversation continue avec
 * l'équipe support (texte libre, pas de catégorie), avec réponses admin
 * visibles dans l'app (voir aussi backoffice/support pour la vue admin).
 * Monté sous /me.
 */
export async function supportRoutes(app: FastifyInstance) {
  app.addHook('preHandler', app.authenticate);
  const sec = { tags: ['support'] as const, security: [{ bearerAuth: [] }] };

  app.post(
    '/support',
    { schema: { ...sec, summary: 'Envoyer un message support (réclamation ou suggestion)' } },
    supportController.send,
  );

  app.get(
    '/support',
    { schema: { ...sec, summary: 'Lire le fil complet de la conversation support' } },
    supportController.thread,
  );
}

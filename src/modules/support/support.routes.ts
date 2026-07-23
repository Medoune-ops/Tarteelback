import type { FastifyInstance } from 'fastify';
import { supportController } from './support.controller.js';

/**
 * Support — Paramètres → Support côté app. Texte libre (réclamation ou
 * suggestion, pas de catégorie), visible en lecture seule dans le back-office
 * (GET /backoffice/support). Monté sous /me.
 */
export async function supportRoutes(app: FastifyInstance) {
  app.addHook('preHandler', app.authenticate);
  const sec = { tags: ['support'] as const, security: [{ bearerAuth: [] }] };

  app.post(
    '/support',
    { schema: { ...sec, summary: 'Envoyer un message support (réclamation ou suggestion)' } },
    supportController.send,
  );
}

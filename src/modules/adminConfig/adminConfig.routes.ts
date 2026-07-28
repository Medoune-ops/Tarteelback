import type { FastifyInstance } from 'fastify';
import { adminConfigController } from './adminConfig.controller.js';

/**
 * Back-office: réglages produit globaux, appliqués sans redéploiement
 * (masquer les paiements le temps d'une revue store, tarification premium/
 * gemmes). Requiert un membre back-office authentifié (app.authenticateAdmin).
 * `paymentsEnabled` seul est aussi exposé en lecture publique via GET /config
 * (voir publicConfig.routes.ts) — jamais la tarification, qui resterait
 * publique/scrapable sinon.
 */
export async function adminConfigRoutes(app: FastifyInstance) {
  app.addHook('preHandler', app.authenticateAdmin);

  const sec = { tags: ['backoffice'] as const, security: [{ bearerAuth: [] }] };

  app.get('/', { schema: { ...sec, summary: 'Réglages produit globaux actuels (paiements + tarification)' } }, adminConfigController.getAdmin);
  app.patch(
    '/',
    { schema: { ...sec, summary: 'Met à jour les réglages produit globaux (paymentsEnabled et/ou tarification)' } },
    adminConfigController.update,
  );
}

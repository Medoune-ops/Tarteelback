import type { FastifyInstance } from 'fastify';
import { adminConfigController } from './adminConfig.controller.js';

/**
 * Back-office: réglages produit globaux, appliqués sans redéploiement
 * (ex: masquer les paiements le temps d'une revue store). Requiert un
 * membre back-office authentifié (app.authenticateAdmin). Le flag lui-même
 * est aussi exposé en lecture publique via GET /config (voir publicConfig.routes.ts) —
 * l'app le lit avant toute connexion.
 */
export async function adminConfigRoutes(app: FastifyInstance) {
  app.addHook('preHandler', app.authenticateAdmin);

  const sec = { tags: ['backoffice'] as const, security: [{ bearerAuth: [] }] };

  app.get('/', { schema: { ...sec, summary: 'Réglages produit globaux actuels' } }, adminConfigController.get);
  app.patch(
    '/',
    { schema: { ...sec, summary: 'Met à jour les réglages produit globaux (ex: paymentsEnabled)' } },
    adminConfigController.update,
  );
}

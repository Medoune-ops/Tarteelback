import type { FastifyInstance } from 'fastify';
import { adminConfigController } from './adminConfig.controller.js';

/**
 * Réglages produit globaux — lecture PUBLIQUE (pas d'auth), montée sous
 * GET /config : l'app mobile la consulte au démarrage, avant toute connexion,
 * pour savoir si elle doit masquer l'UI de paiement (ex: en attente d'une
 * revue store). Écriture réservée au back-office (adminConfig.routes.ts).
 */
export async function publicConfigRoutes(app: FastifyInstance) {
  app.get(
    '/config',
    { schema: { tags: ['config'] as const, summary: 'Réglages produit globaux (lecture publique, pas d\'auth)' } },
    adminConfigController.get,
  );
}

import type { FastifyInstance } from 'fastify';
import { adminConfigController } from './adminConfig.controller.js';

/**
 * Back-office: réglages produit globaux, appliqués sans redéploiement
 * (masquer les paiements le temps d'une revue store, tarification premium/
 * gemmes, promo "Premium pour tous"). Rattaché au module 'monetization' (pas
 * de module 'config' dédié dans l'enum, et l'impact est financier). `paymentsEnabled`
 * seul est aussi exposé en lecture publique via GET /config (voir
 * publicConfig.routes.ts) — jamais la tarification, qui resterait publique/
 * scrapable sinon.
 */
export async function adminConfigRoutes(app: FastifyInstance) {
  const sec = { tags: ['backoffice'] as const, security: [{ bearerAuth: [] }] };
  const view = app.requireAdminPermission('monetization', 'view');
  const edit = app.requireAdminPermission('monetization', 'edit');

  app.get('/', { preHandler: view, schema: { ...sec, summary: 'Réglages produit globaux actuels (paiements + tarification)' } }, adminConfigController.getAdmin);
  app.patch(
    '/',
    { preHandler: edit, schema: { ...sec, summary: 'Met à jour les réglages produit globaux (paymentsEnabled et/ou tarification)' } },
    adminConfigController.update,
  );
}

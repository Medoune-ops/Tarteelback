import type { FastifyInstance } from 'fastify';
import { referralController } from './referral.controller.js';

/**
 * Parrainage — monté sous /me. Le compte partage son `referralCode` ; un
 * nouveau compte le saisit via /redeem et parrain + filleul gagnent des cœurs.
 */
export async function referralRoutes(app: FastifyInstance) {
  app.addHook('preHandler', app.authenticate);
  const sec = { tags: ['referral'] as const, security: [{ bearerAuth: [] }] };

  app.get(
    '/referral',
    { schema: { ...sec, summary: 'Mon code de parrainage + nombre de filleuls' } },
    referralController.get,
  );

  app.post(
    '/referral/redeem',
    { schema: { ...sec, summary: "Saisir le code d'un parrain (cœurs bonus pour les deux)" } },
    referralController.redeem,
  );
}

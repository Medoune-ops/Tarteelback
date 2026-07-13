import type { FastifyInstance } from 'fastify';
import { householdController } from './household.controller.js';

/**
 * Plan familial (foyer) — monté sous /me. Un propriétaire, jusqu'à 5 membres.
 * Quand l'abonnement familial est actif, tous les membres sont premium.
 * Toutes les routes sont authentifiées ; les actions de gestion (invite,
 * retrait, transfert, suppression) sont réservées au propriétaire (403 sinon).
 */
export async function householdRoutes(app: FastifyInstance) {
  app.addHook('preHandler', app.authenticate);
  const sec = { tags: ['household'] as const, security: [{ bearerAuth: [] }] };

  app.get(
    '/household',
    { schema: { ...sec, summary: 'Mon foyer + membres + invitations' } },
    householdController.get,
  );
  app.post(
    '/household',
    { schema: { ...sec, summary: 'Créer un foyer (devenir propriétaire)' } },
    householdController.create,
  );
  app.delete(
    '/household',
    { schema: { ...sec, summary: 'Supprimer mon foyer (propriétaire)' } },
    householdController.remove,
  );
  app.post(
    '/household/leave',
    { schema: { ...sec, summary: 'Quitter le foyer (membre non propriétaire)' } },
    householdController.leave,
  );
  app.post(
    '/household/transfer',
    { schema: { ...sec, summary: 'Transférer la propriété à un membre' } },
    householdController.transfer,
  );

  app.post(
    '/household/invitations',
    { schema: { ...sec, summary: 'Inviter un compte par email (propriétaire)' } },
    householdController.invite,
  );
  app.post(
    '/household/invitations/:token/accept',
    { schema: { ...sec, summary: 'Accepter une invitation' } },
    householdController.accept,
  );
  app.post(
    '/household/invitations/:token/decline',
    { schema: { ...sec, summary: 'Refuser une invitation' } },
    householdController.decline,
  );
  app.delete(
    '/household/invitations/:id',
    { schema: { ...sec, summary: 'Annuler une invitation envoyée (propriétaire)' } },
    householdController.cancelInvitation,
  );

  app.delete(
    '/household/members/:userId',
    { schema: { ...sec, summary: 'Retirer un membre (propriétaire)' } },
    householdController.removeMember,
  );
}

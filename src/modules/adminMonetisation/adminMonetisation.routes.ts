import type { FastifyInstance } from 'fastify';
import { adminMonetisationController } from './adminMonetisation.controller.js';

/**
 * Back-office monétisation : KPIs premium/MRR/ARPU dérivés des vrais comptes
 * User/Household et des vrais prix (src/config/env.ts), et le journal des
 * transactions réelles (Transaction). Lecture seule — aucune action de
 * remboursement/annulation ici (ambigu, hors périmètre). Chaque route requiert
 * un membre back-office authentifié (app.authenticateAdmin).
 */
export async function adminMonetisationRoutes(app: FastifyInstance) {
  app.addHook('preHandler', app.authenticateAdmin);

  const sec = { tags: ['backoffice'] as const, security: [{ bearerAuth: [] }] };

  app.get('/summary', { schema: { ...sec, summary: 'KPIs monétisation (premium actifs, MRR, ARPU, expirations proches)' } }, adminMonetisationController.summary);
  app.get('/transactions', { schema: { ...sec, summary: 'Liste paginée des transactions (abonnements, packs, réparations)' } }, adminMonetisationController.listTransactions);
}

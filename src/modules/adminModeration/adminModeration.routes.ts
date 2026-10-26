import type { FastifyInstance, FastifyRequest } from 'fastify';
import { parse } from '../../core/validate.js';
import { adminModerationService } from './adminModeration.service.js';
import {
  listReportsQuerySchema,
  reportParamsSchema,
  resolveReportBodySchema,
  userParamsSchema,
} from './adminModeration.schemas.js';

const actor = (req: FastifyRequest) => ({ adminUserId: req.adminAuth!.sub, ipAddress: req.ip });

/**
 * Back-office : file des signalements des fonctions entre amis (ticket 5.1).
 * Permission dédiée « moderation » (view pour lire, edit pour agir). Chaque
 * action est journalisée dans AdminActivityLog.
 */
export async function adminModerationRoutes(app: FastifyInstance) {
  const sec = { tags: ['backoffice'] as const, security: [{ bearerAuth: [] }] };
  const view = app.requireAdminPermission('moderation', 'view');
  const edit = app.requireAdminPermission('moderation', 'edit');

  app.get('/reports', { preHandler: view, schema: { ...sec, summary: 'File des signalements (filtre statut / compte visé)' } }, async (req) =>
    adminModerationService.list(parse(listReportsQuerySchema, req.query ?? {})),
  );

  app.get('/summary', { preHandler: view, schema: { ...sec, summary: 'Compteurs : signalements ouverts, reçus en 24 h' } }, async () =>
    adminModerationService.summary(),
  );

  app.post('/reports/:id/resolve', { preHandler: edit, schema: { ...sec, summary: 'Traiter un signalement (classer, couper les amis, bannir)' } }, async (req) => {
    const { id } = parse(reportParamsSchema, req.params);
    return adminModerationService.resolve(id, parse(resolveReportBodySchema, req.body ?? {}), actor(req));
  });

  app.post('/users/:userId/friends-disable', { preHandler: edit, schema: { ...sec, summary: 'Couper l’accès aux fonctions entre amis' } }, async (req) => {
    const { userId } = parse(userParamsSchema, req.params);
    return adminModerationService.setFriendsAccess(userId, false, actor(req));
  });

  app.post('/users/:userId/friends-enable', { preHandler: edit, schema: { ...sec, summary: 'Rétablir l’accès aux fonctions entre amis' } }, async (req) => {
    const { userId } = parse(userParamsSchema, req.params);
    return adminModerationService.setFriendsAccess(userId, true, actor(req));
  });
}

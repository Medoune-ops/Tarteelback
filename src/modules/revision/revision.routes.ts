import type { FastifyInstance } from 'fastify';
import { revisionController } from './revision.controller.js';

/**
 * SRS des sourates apprises. Mounted sous /me. `SourateRevision` existe déjà
 * dans le schéma (prisma/schema.prisma) — ce module est le premier à le
 * lire/écrire.
 */
export async function revisionRoutes(app: FastifyInstance) {
  app.addHook('preHandler', app.authenticate);
  const sec = { tags: ['revision'] as const, security: [{ bearerAuth: [] }] };

  app.get(
    '/revisions',
    { schema: { ...sec, summary: 'Sourates apprises + état SRS (score, prochaine révision)' } },
    revisionController.list,
  );

  app.post(
    '/revisions/:idOrNumero/review',
    { schema: { ...sec, summary: "Enregistre le résultat d'une session de révision (SRS)" } },
    revisionController.review,
  );
}

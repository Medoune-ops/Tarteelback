import type { FastifyInstance } from 'fastify';
import multipart from '@fastify/multipart';
import { revisionController } from './revision.controller.js';

/**
 * Révision des sourates apprises, monté sous /me :
 *   - SRS : GET /revisions, POST /revisions/:idOrNumero/review (score, planning) ;
 *   - Vocal : POST /revisions/versets/:versetId/recite (récitation notée Whisper).
 * AUCUN cœur n'est jamais en jeu ici (contrairement au moteur de leçon).
 */
export async function revisionRoutes(app: FastifyInstance) {
  // Parser multipart limité à ce module — seul /recite envoie de l'audio.
  await app.register(multipart, {
    limits: { fileSize: 10 * 1024 * 1024, files: 1, fields: 0 },
  });

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

  app.post(
    '/revisions/versets/:versetId/recite',
    {
      schema: {
        ...sec,
        summary:
          'Récitation d\'un verset notée par Whisper ASR (multipart "audio"). Jamais de cœur en jeu. 503 si ASR non configuré.',
        consumes: ['multipart/form-data'],
      },
    },
    revisionController.recite,
  );
}

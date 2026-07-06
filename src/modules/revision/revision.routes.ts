import type { FastifyInstance } from 'fastify';
import multipart from '@fastify/multipart';
import { revisionController } from './revision.controller.js';

/**
 * Session de révision libre (SRS, écran flashcard du front) : récitation d'un
 * verset notée par l'ASR serveur. AUCUN cœur en jeu ici (contrairement au
 * moteur de leçon) — la révision ne doit jamais pénaliser.
 */
export async function revisionRoutes(app: FastifyInstance) {
  await app.register(multipart, {
    limits: { fileSize: 10 * 1024 * 1024, files: 1, fields: 0 },
  });

  app.addHook('preHandler', app.authenticate);

  app.post(
    '/versets/:versetId/recite',
    {
      schema: {
        tags: ['revision'],
        summary:
          'Submit a recitation recording for a verse (multipart "audio"); server-side Whisper ASR scores it. Never costs a heart. 503 when ASR is not configured.',
        security: [{ bearerAuth: [] }],
        consumes: ['multipart/form-data'],
      },
    },
    revisionController.recite,
  );
}

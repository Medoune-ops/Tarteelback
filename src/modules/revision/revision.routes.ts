import type { FastifyInstance } from 'fastify';
import multipart from '@fastify/multipart';
import { revisionController } from './revision.controller.js';

/**
 * Révision des sourates ET des leçons d'alphabet/harakat apprises, monté sous /me :
 *   - SRS sourates, PAR SEGMENT (bloc de versets, cf. core/revision.ts) :
 *     GET /revisions (vue agrégée), GET /revisions/:idOrNumero/segments (détail
 *     par bloc), POST /revisions/:idOrNumero/segments/:segmentIndex/review ;
 *   - SRS alphabet/harakat : GET /revisions/lettres, POST /revisions/lettres/:lessonId/review ;
 *   - Vocal : POST /revisions/versets/:versetId/recite (récitation notée Whisper) ;
 *     POST /revisions/lettres/steps/:stepId/recite (prononciation d'une lettre).
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
    {
      schema: {
        ...sec,
        summary: 'Sourates apprises + état SRS agrégé (pire segment, score moyen, prochaine échéance)',
      },
    },
    revisionController.list,
  );

  app.get(
    '/revisions/:idOrNumero/segments',
    { schema: { ...sec, summary: 'Détail par segment (bloc de versets) du SRS d\'une sourate' } },
    revisionController.getSegments,
  );

  app.post(
    '/revisions/:idOrNumero/segments/:segmentIndex/review',
    { schema: { ...sec, summary: "Enregistre le résultat d'une session de révision pour UN segment (SRS)" } },
    revisionController.reviewSegment,
  );

  app.get(
    '/revisions/lettres',
    { schema: { ...sec, summary: 'Leçons alphabet/harakat complétées + état SRS' } },
    revisionController.listLettres,
  );

  app.post(
    '/revisions/lettres/:lessonId/review',
    { schema: { ...sec, summary: "Enregistre le résultat d'une révision alphabet/harakat (SRS)" } },
    revisionController.reviewLettre,
  );

  app.post(
    '/revisions/lettres/steps/:stepId/recite',
    {
      schema: {
        ...sec,
        summary:
          'Prononciation d\'une lettre/syllabe notée par Whisper ASR (multipart "audio"). Jamais de cœur en jeu. 503 si ASR non configuré.',
        consumes: ['multipart/form-data'],
      },
    },
    revisionController.reciteLettre,
  );

  app.post(
    '/revisions/lettres/:lessonId/recite-range',
    {
      schema: {
        ...sec,
        summary:
          'Prononciation ASSEMBLÉE de plusieurs lettres/syllabes consécutives (?debut=&fin=, ordre des steps), notée par Whisper ASR (multipart "audio") — exercice de chaînage. Jamais de cœur en jeu.',
        consumes: ['multipart/form-data'],
      },
    },
    revisionController.reciteLettreRange,
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

  app.post(
    '/revisions/:idOrNumero/recite-range',
    {
      schema: {
        ...sec,
        summary:
          'Récitation ASSEMBLÉE de plusieurs versets consécutifs (?debut=&fin=), notée par Whisper ASR (multipart "audio") — exercice de chaînage. Jamais de cœur en jeu.',
        consumes: ['multipart/form-data'],
      },
    },
    revisionController.reciteRange,
  );
}

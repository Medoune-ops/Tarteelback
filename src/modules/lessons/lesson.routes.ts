import type { FastifyInstance } from 'fastify';
import multipart from '@fastify/multipart';
import { lessonController } from './lesson.controller.js';

/**
 * Lesson-engine POST routes (judging & completion). GET /lessons/:id is served
 * by the content module. All routes here require authentication because they
 * mutate hearts/XP/streak.
 */
export async function lessonRoutes(app: FastifyInstance) {
  // Multipart parser scoped to this module — only /answer-voice uploads audio.
  // 10 MiB is generous for a single-ayah recording (Expo m4a ≈ 100 KiB/s).
  await app.register(multipart, {
    limits: { fileSize: 10 * 1024 * 1024, files: 1, fields: 2 },
  });

  app.addHook('preHandler', app.authenticate);
  const sec = { tags: ['lessons'] as const, security: [{ bearerAuth: [] }] };

  app.post(
    '/:id/steps/:stepId/answer',
    { schema: { ...sec, summary: 'Submit an answer (server judges, may cost a heart)' } },
    lessonController.answer,
  );

  app.post(
    '/:id/steps/:stepId/answer-voice',
    {
      schema: {
        ...sec,
        summary:
          'Submit a voice recording (multipart "audio"); server-side Whisper ASR scores the recitation — may cost a heart. 503 when ASR is not configured.',
        consumes: ['multipart/form-data'],
      },
    },
    lessonController.answerVoice,
  );

  app.post(
    '/:id/complete',
    { schema: { ...sec, summary: 'Complete a lesson (XP, streak, weeklyXp, league)' } },
    lessonController.complete,
  );
}

/**
 * Flat completion route mounted at /lesson/complete (singular) — the RN store's
 * contract (BACKEND.md): lessonId in the body, returns the flat /me shape.
 */
export async function lessonFlatRoutes(app: FastifyInstance) {
  app.addHook('preHandler', app.authenticate);
  app.post(
    '/complete',
    {
      schema: {
        tags: ['lessons'],
        summary: 'Complete a lesson, return flat user state (RN store)',
        security: [{ bearerAuth: [] }],
      },
    },
    lessonController.completeFlat,
  );
}

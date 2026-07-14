import type { FastifyInstance } from 'fastify';
import { contentController } from './content.controller.js';

/**
 * Public content reads. GET /lessons/:id lives here (the POST lesson-engine
 * routes are mounted under /lessons by the lessons module).
 */
export async function contentRoutes(app: FastifyInstance) {
  app.get(
    '/sections',
    { schema: { tags: ['content'], summary: 'Full learning path (PARCOURS_SECTIONS, label in ?lang / Accept-Language)' } },
    contentController.sections,
  );

  app.get(
    '/sections/:id/lessons',
    { schema: { tags: ['content'], summary: 'Lessons of a section (step text in ?lang / Accept-Language)' } },
    contentController.sectionLessons,
  );

  app.get(
    '/lessons/:id',
    {
      schema: {
        tags: ['content'],
        summary: 'Lesson with its step sequence (no answer keys, text in ?lang / Accept-Language)',
      },
    },
    contentController.lesson,
  );

  app.get(
    '/sourates',
    { schema: { tags: ['content'], summary: 'List the 114 sourates' } },
    contentController.sourates,
  );

  app.get(
    '/sourates/:id/versets',
    {
      schema: {
        tags: ['content'],
        summary: 'Verses of a sourate (translation in ?lang / Accept-Language)',
      },
    },
    contentController.versets,
  );
}

import type { FastifyInstance, FastifyRequest } from 'fastify';
import { parse } from '../../core/validate.js';
import { bumpContentVersion } from '../../core/cache.js';
import { adminService } from './admin.service.js';
import {
  sectionCreateSchema,
  sectionUpdateSchema,
  lessonCreateSchema,
  lessonUpdateSchema,
  stepCreateSchema,
  sourateCreateSchema,
  sourateUpdateSchema,
  versetCreateSchema,
  versetUpdateSchema,
} from './admin.schemas.js';

const idOf = (req: FastifyRequest) => (req.params as { id: string }).id;

/** Admin content management. Every route requires the admin role. */
export async function adminRoutes(app: FastifyInstance) {
  app.addHook('preHandler', app.requireAdmin);

  // Any successful content mutation invalidates the whole content cache by
  // bumping the global version (cheap, covers every route at once).
  app.addHook('onResponse', async (req, reply) => {
    if (req.method !== 'GET' && reply.statusCode < 400) {
      await bumpContentVersion();
    }
  });
  const sec = { tags: ['admin'] as const, security: [{ bearerAuth: [] }] };

  // Sections
  app.post('/sections', { schema: { ...sec, summary: 'Create section' } }, async (req, reply) =>
    reply.status(201).send(await adminService.createSection(parse(sectionCreateSchema, req.body))),
  );
  app.patch('/sections/:id', { schema: { ...sec, summary: 'Update section' } }, async (req, reply) =>
    reply.send(await adminService.updateSection(idOf(req), parse(sectionUpdateSchema, req.body))),
  );
  app.delete('/sections/:id', { schema: { ...sec, summary: 'Delete section' } }, async (req, reply) => {
    await adminService.deleteSection(idOf(req));
    return reply.status(204).send();
  });

  // Lessons
  app.post('/lessons', { schema: { ...sec, summary: 'Create lesson' } }, async (req, reply) =>
    reply.status(201).send(await adminService.createLesson(parse(lessonCreateSchema, req.body))),
  );
  app.patch('/lessons/:id', { schema: { ...sec, summary: 'Update lesson' } }, async (req, reply) =>
    reply.send(await adminService.updateLesson(idOf(req), parse(lessonUpdateSchema, req.body))),
  );
  app.delete('/lessons/:id', { schema: { ...sec, summary: 'Delete lesson' } }, async (req, reply) => {
    await adminService.deleteLesson(idOf(req));
    return reply.status(204).send();
  });

  // Lesson steps
  app.post('/steps', { schema: { ...sec, summary: 'Create lesson step' } }, async (req, reply) =>
    reply.status(201).send(await adminService.createStep(parse(stepCreateSchema, req.body))),
  );
  app.delete('/steps/:id', { schema: { ...sec, summary: 'Delete lesson step' } }, async (req, reply) => {
    await adminService.deleteStep(idOf(req));
    return reply.status(204).send();
  });

  // Sourates
  app.post('/sourates', { schema: { ...sec, summary: 'Create sourate' } }, async (req, reply) =>
    reply.status(201).send(await adminService.createSourate(parse(sourateCreateSchema, req.body))),
  );
  app.patch('/sourates/:id', { schema: { ...sec, summary: 'Update sourate' } }, async (req, reply) =>
    reply.send(await adminService.updateSourate(idOf(req), parse(sourateUpdateSchema, req.body))),
  );
  app.delete('/sourates/:id', { schema: { ...sec, summary: 'Delete sourate' } }, async (req, reply) => {
    await adminService.deleteSourate(idOf(req));
    return reply.status(204).send();
  });

  // Versets
  app.post('/versets', { schema: { ...sec, summary: 'Create verset' } }, async (req, reply) =>
    reply.status(201).send(await adminService.createVerset(parse(versetCreateSchema, req.body))),
  );
  app.patch('/versets/:id', { schema: { ...sec, summary: 'Update verset' } }, async (req, reply) =>
    reply.send(await adminService.updateVerset(idOf(req), parse(versetUpdateSchema, req.body))),
  );
  app.delete('/versets/:id', { schema: { ...sec, summary: 'Delete verset' } }, async (req, reply) => {
    await adminService.deleteVerset(idOf(req));
    return reply.status(204).send();
  });
}

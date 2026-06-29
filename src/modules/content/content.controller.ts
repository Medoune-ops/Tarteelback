import type { FastifyReply, FastifyRequest } from 'fastify';
import { env } from '../../config/env.js';
import { tryAuth, resolveLang } from '../../core/optionalAuth.js';
import { contentService } from './content.service.js';

export const contentController = {
  async sections(req: FastifyRequest, reply: FastifyReply) {
    const claims = await tryAuth(req); // personalised node states when logged in
    const sections = await contentService.getSections(claims?.sub ?? null);
    return reply.send({ sections });
  },

  async sectionLessons(req: FastifyRequest, reply: FastifyReply) {
    const { id } = req.params as { id: string };
    const lessons = await contentService.getLessonsForSection(id);
    return reply.send({ lessons });
  },

  async lesson(req: FastifyRequest, reply: FastifyReply) {
    const { id } = req.params as { id: string };
    const lesson = await contentService.getLesson(id);
    return reply.send({ lesson });
  },

  async sourates(_req: FastifyRequest, reply: FastifyReply) {
    const sourates = await contentService.listSourates();
    return reply.send({ sourates });
  },

  async versets(req: FastifyRequest, reply: FastifyReply) {
    const { id } = req.params as { id: string };
    const lang = resolveLang(req, env.DEFAULT_LANG);
    const result = await contentService.getVersets(id, lang);
    return reply.send(result);
  },
};

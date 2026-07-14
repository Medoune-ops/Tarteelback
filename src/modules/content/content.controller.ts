import type { FastifyReply, FastifyRequest } from 'fastify';
import { env } from '../../config/env.js';
import { tryAuth, resolveLang } from '../../core/optionalAuth.js';
import { contentService } from './content.service.js';

export const contentController = {
  async sections(req: FastifyRequest, reply: FastifyReply) {
    const claims = await tryAuth(req); // personalised node states when logged in
    const lang = resolveLang(req, env.DEFAULT_LANG);
    const sections = await contentService.getSections(claims?.sub ?? null, lang);
    return reply.send({ sections });
  },

  async sectionLessons(req: FastifyRequest, reply: FastifyReply) {
    const { id } = req.params as { id: string };
    const lang = resolveLang(req, env.DEFAULT_LANG);
    const lessons = await contentService.getLessonsForSection(id, lang);
    return reply.send({ lessons });
  },

  async lesson(req: FastifyRequest, reply: FastifyReply) {
    const { id } = req.params as { id: string };
    const lang = resolveLang(req, env.DEFAULT_LANG);
    const lesson = await contentService.getLesson(id, lang);
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

import type { FastifyReply, FastifyRequest } from 'fastify';
import { parse } from '../../core/validate.js';
import { adminContentService } from './adminContent.service.js';
import { setPublishedSchema } from './adminContent.schemas.js';

const idParam = (req: FastifyRequest) => (req.params as { id: string }).id;

export const adminContentController = {
  async list(_req: FastifyRequest, reply: FastifyReply) {
    return reply.send({ sections: await adminContentService.listSections() });
  },

  async summary(_req: FastifyRequest, reply: FastifyReply) {
    return reply.send(await adminContentService.summary());
  },

  async setPublished(req: FastifyRequest, reply: FastifyReply) {
    const input = parse(setPublishedSchema, req.body);
    return reply.send(await adminContentService.setPublished(idParam(req), input.published));
  },
};

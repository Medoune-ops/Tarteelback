import type { FastifyReply, FastifyRequest } from 'fastify';
import { parse } from '../../core/validate.js';
import { adminSupportService } from './adminSupport.service.js';
import { listSupportQuerySchema } from './adminSupport.schemas.js';

export const adminSupportController = {
  async list(req: FastifyRequest, reply: FastifyReply) {
    const query = parse(listSupportQuerySchema, req.query);
    return reply.send(await adminSupportService.list(query));
  },

  async summary(_req: FastifyRequest, reply: FastifyReply) {
    return reply.send(await adminSupportService.summary());
  },

  async toggleRead(req: FastifyRequest, reply: FastifyReply) {
    const { id } = req.params as { id: string };
    return reply.send(await adminSupportService.toggleRead(id));
  },
};

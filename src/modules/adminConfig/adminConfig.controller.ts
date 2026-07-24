import type { FastifyReply, FastifyRequest } from 'fastify';
import { parse } from '../../core/validate.js';
import { adminConfigService } from './adminConfig.service.js';
import { updateConfigBodySchema } from './adminConfig.schemas.js';

export const adminConfigController = {
  async get(_req: FastifyRequest, reply: FastifyReply) {
    return reply.send(await adminConfigService.get());
  },

  async update(req: FastifyRequest, reply: FastifyReply) {
    const body = parse(updateConfigBodySchema, req.body);
    return reply.send(await adminConfigService.update(body));
  },
};

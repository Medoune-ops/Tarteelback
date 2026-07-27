import type { FastifyReply, FastifyRequest } from 'fastify';
import { parse } from '../../core/validate.js';
import { adminConfigService } from './adminConfig.service.js';
import { updateConfigBodySchema } from './adminConfig.schemas.js';

export const adminConfigController = {
  /** GET /config (public) */
  async getPublic(_req: FastifyRequest, reply: FastifyReply) {
    return reply.send(await adminConfigService.getPublic());
  },

  /** GET /backoffice/config */
  async getAdmin(_req: FastifyRequest, reply: FastifyReply) {
    return reply.send(await adminConfigService.getAdmin());
  },

  /** PATCH /backoffice/config */
  async update(req: FastifyRequest, reply: FastifyReply) {
    const body = parse(updateConfigBodySchema, req.body);
    return reply.send(await adminConfigService.update(body));
  },
};

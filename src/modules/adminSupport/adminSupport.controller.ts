import type { FastifyReply, FastifyRequest } from 'fastify';
import { parse } from '../../core/validate.js';
import { adminSupportService } from './adminSupport.service.js';
import { listSupportQuerySchema, replySupportSchema } from './adminSupport.schemas.js';

export const adminSupportController = {
  async list(req: FastifyRequest, reply: FastifyReply) {
    const query = parse(listSupportQuerySchema, req.query);
    return reply.send(await adminSupportService.list(query));
  },

  async summary(_req: FastifyRequest, reply: FastifyReply) {
    return reply.send(await adminSupportService.summary());
  },

  async thread(req: FastifyRequest, reply: FastifyReply) {
    const { userId } = req.params as { userId: string };
    const messages = await adminSupportService.thread(userId);
    return reply.send({ messages });
  },

  async reply(req: FastifyRequest, reply: FastifyReply) {
    const { userId } = req.params as { userId: string };
    const input = parse(replySupportSchema, req.body);
    const result = await adminSupportService.reply(userId, input);
    return reply.code(201).send(result);
  },
};

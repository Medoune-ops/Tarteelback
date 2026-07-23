import type { FastifyReply, FastifyRequest } from 'fastify';
import { parse } from '../../core/validate.js';
import { supportService } from './support.service.js';
import { sendSupportMessageSchema } from './support.schemas.js';

export const supportController = {
  async send(req: FastifyRequest, reply: FastifyReply) {
    const input = parse(sendSupportMessageSchema, req.body);
    const result = await supportService.send(req.auth!.sub, input);
    return reply.code(201).send(result);
  },
};

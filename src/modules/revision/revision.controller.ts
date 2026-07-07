import type { FastifyReply, FastifyRequest } from 'fastify';
import { parse } from '../../core/validate.js';
import { revisionService } from './revision.service.js';
import { reviewSchema } from './revision.schemas.js';

export const revisionController = {
  async list(req: FastifyRequest, reply: FastifyReply) {
    const result = await revisionService.list(req.auth!.sub);
    return reply.send(result);
  },

  async review(req: FastifyRequest, reply: FastifyReply) {
    const { idOrNumero } = req.params as { idOrNumero: string };
    const body = parse(reviewSchema, req.body ?? {});
    const result = await revisionService.review(req.auth!.sub, idOrNumero, body.quality);
    return reply.send(result);
  },
};

import type { FastifyReply, FastifyRequest } from 'fastify';
import { parse } from '../../core/validate.js';
import { billingService } from './billing.service.js';
import { subscribeSchema } from './billing.schemas.js';

export const billingController = {
  async subscribe(req: FastifyRequest, reply: FastifyReply) {
    const input = parse(subscribeSchema, req.body);
    const result = await billingService.subscribe(req.auth!.sub, input);
    return reply.send(result);
  },

  async status(req: FastifyRequest, reply: FastifyReply) {
    const result = await billingService.status(req.auth!.sub);
    return reply.send(result);
  },

  async repairStreak(req: FastifyRequest, reply: FastifyReply) {
    const result = await billingService.repairStreak(req.auth!.sub);
    return reply.send(result);
  },
};

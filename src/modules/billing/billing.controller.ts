import type { FastifyReply, FastifyRequest } from 'fastify';
import { parse } from '../../core/validate.js';
import { billingService } from './billing.service.js';
import { subscribeSchema, buyGemsSchema, buyHeartsSchema } from './billing.schemas.js';

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

  async cancelSubscription(req: FastifyRequest, reply: FastifyReply) {
    const result = await billingService.cancelSubscription(req.auth!.sub);
    return reply.send(result);
  },

  async getTransaction(req: FastifyRequest, reply: FastifyReply) {
    const { reference } = req.params as { reference: string };
    const result = await billingService.getTransaction(req.auth!.sub, reference);
    return reply.send(result);
  },

  async buyGems(req: FastifyRequest, reply: FastifyReply) {
    const input = parse(buyGemsSchema, req.body);
    const result = await billingService.buyGems(req.auth!.sub, input);
    return reply.send(result);
  },

  async buyHearts(req: FastifyRequest, reply: FastifyReply) {
    const input = parse(buyHeartsSchema, req.body ?? {});
    const result = await billingService.buyHearts(req.auth!.sub, input);
    return reply.send(result);
  },

  async repairStreak(req: FastifyRequest, reply: FastifyReply) {
    const result = await billingService.repairStreak(req.auth!.sub);
    return reply.send(result);
  },
};

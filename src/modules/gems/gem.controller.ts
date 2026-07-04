import type { FastifyReply, FastifyRequest } from 'fastify';
import { gemService } from './gem.service.js';

export const gemController = {
  async status(req: FastifyRequest, reply: FastifyReply) {
    const result = await gemService.status(req.auth!.sub);
    return reply.send(result);
  },

  async refillHearts(req: FastifyRequest, reply: FastifyReply) {
    const result = await gemService.refillHearts(req.auth!.sub);
    return reply.send(result);
  },

  async reviewRegainHeart(req: FastifyRequest, reply: FastifyReply) {
    const result = await gemService.reviewRegainHeart(req.auth!.sub);
    return reply.send(result);
  },

  async buyStreakFreeze(req: FastifyRequest, reply: FastifyReply) {
    const result = await gemService.buyStreakFreeze(req.auth!.sub);
    return reply.send(result);
  },

  async buyDoubleXp(req: FastifyRequest, reply: FastifyReply) {
    const result = await gemService.buyDoubleXp(req.auth!.sub);
    return reply.send(result);
  },
};

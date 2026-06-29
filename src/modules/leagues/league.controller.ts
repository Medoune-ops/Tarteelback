import type { FastifyReply, FastifyRequest } from 'fastify';
import { userRepository } from '../me/user.repository.js';
import { leagueService } from './league.service.js';

export const leagueController = {
  async join(req: FastifyRequest, reply: FastifyReply) {
    const user = await userRepository.getOrThrow(req.auth!.sub);
    const result = await leagueService.join(user.id, user.weeklyXp);
    return reply.send(result);
  },

  async me(req: FastifyRequest, reply: FastifyReply) {
    const result = await leagueService.me(req.auth!.sub);
    return reply.send(result);
  },

  async list(_req: FastifyRequest, reply: FastifyReply) {
    const leagues = await leagueService.listLeagues();
    return reply.send({ leagues });
  },
};

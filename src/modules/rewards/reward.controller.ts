import type { FastifyReply, FastifyRequest } from 'fastify';
import { parse } from '../../core/validate.js';
import { rewardService } from './reward.service.js';
import { setStreakGoalSchema } from './reward.schemas.js';

export const rewardController = {
  async setStreakGoal(req: FastifyRequest, reply: FastifyReply) {
    const input = parse(setStreakGoalSchema, req.body);
    const result = await rewardService.setStreakGoal(req.auth!.sub, input.days);
    return reply.send(result);
  },

  async claimStreakReward(req: FastifyRequest, reply: FastifyReply) {
    const result = await rewardService.claimStreakReward(req.auth!.sub);
    return reply.send(result);
  },

  async listPodiums(req: FastifyRequest, reply: FastifyReply) {
    const podiums = await rewardService.listPodiums(req.auth!.sub);
    return reply.send({ podiums });
  },

  async claimPodium(req: FastifyRequest, reply: FastifyReply) {
    const { ref } = req.params as { ref: string };
    const result = await rewardService.claimPodium(req.auth!.sub, ref);
    return reply.send(result);
  },

  async dailyChestStatus(req: FastifyRequest, reply: FastifyReply) {
    const result = await rewardService.dailyChestStatus(req.auth!.sub);
    return reply.send(result);
  },

  async claimDailyChest(req: FastifyRequest, reply: FastifyReply) {
    const result = await rewardService.claimDailyChest(req.auth!.sub);
    return reply.send(result);
  },
};

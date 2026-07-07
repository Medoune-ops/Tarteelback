import type { FastifyReply, FastifyRequest } from 'fastify';
import { parse } from '../../core/validate.js';
import { referralService } from './referral.service.js';
import { redeemReferralSchema } from './referral.schemas.js';

export const referralController = {
  async get(req: FastifyRequest, reply: FastifyReply) {
    const result = await referralService.getOrCreate(req.auth!.sub);
    return reply.send(result);
  },

  async redeem(req: FastifyRequest, reply: FastifyReply) {
    const body = parse(redeemReferralSchema, req.body ?? {});
    const result = await referralService.redeem(req.auth!.sub, body.code);
    return reply.send(result);
  },
};

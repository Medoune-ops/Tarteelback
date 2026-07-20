import type { FastifyReply, FastifyRequest } from 'fastify';
import { parse } from '../../core/validate.js';
import { adminGiftsService } from './adminGifts.service.js';
import { bulkGrantSchema } from './adminGifts.schemas.js';

export const adminGiftsController = {
  async bulkGrant(req: FastifyRequest, reply: FastifyReply) {
    const input = parse(bulkGrantSchema, req.body);
    return reply.send(await adminGiftsService.bulkGrant(input));
  },
};

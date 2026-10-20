import type { FastifyReply, FastifyRequest } from 'fastify';
import { parse } from '../../core/validate.js';
import { achievementsService } from './achievements.service.js';
import {
  achievementListQuerySchema,
  achievementReactionParamsSchema,
  achievementReactionBodySchema,
} from './achievements.schemas.js';

export const achievementsController = {
  async list(req: FastifyRequest, reply: FastifyReply) {
    const query = parse(achievementListQuerySchema, req.query ?? {});
    const result = await achievementsService.list(req.auth!.sub, query.since);
    return reply.send(result);
  },
  async feed(req: FastifyRequest, reply: FastifyReply) {
    const query = parse(achievementListQuerySchema, req.query ?? {});
    const result = await achievementsService.feed(req.auth!.sub, query.since);
    return reply.send(result);
  },
  async react(req: FastifyRequest, reply: FastifyReply) {
    const params = parse(achievementReactionParamsSchema, req.params);
    const body = parse(achievementReactionBodySchema, req.body);
    const result = await achievementsService.react(req.auth!.sub, params.id, body.kind);
    return reply.send(result);
  },
  async unreact(req: FastifyRequest, reply: FastifyReply) {
    const params = parse(achievementReactionParamsSchema, req.params);
    const result = await achievementsService.unreact(req.auth!.sub, params.id);
    return reply.send(result);
  },
};

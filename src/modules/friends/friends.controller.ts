import type { FastifyReply, FastifyRequest } from 'fastify';
import { parse } from '../../core/validate.js';
import { friendsService } from './friends.service.js';
import {
  sendRequestSchema,
  respondRequestParamsSchema,
  removeFriendParamsSchema,
  cursorQuerySchema,
} from './friends.schemas.js';

export const friendsController = {
  async sendRequest(req: FastifyRequest, reply: FastifyReply) {
    const body = parse(sendRequestSchema, req.body);
    const result = await friendsService.sendRequest(req.auth!.sub, body.code);
    return reply.status(201).send(result);
  },

  async listRequests(req: FastifyRequest, reply: FastifyReply) {
    const result = await friendsService.listRequests(req.auth!.sub);
    return reply.send(result);
  },

  async accept(req: FastifyRequest, reply: FastifyReply) {
    const params = parse(respondRequestParamsSchema, req.params);
    const result = await friendsService.accept(req.auth!.sub, params.id);
    return reply.send(result);
  },

  async decline(req: FastifyRequest, reply: FastifyReply) {
    const params = parse(respondRequestParamsSchema, req.params);
    const result = await friendsService.decline(req.auth!.sub, params.id);
    return reply.send(result);
  },

  async cancel(req: FastifyRequest, reply: FastifyReply) {
    const params = parse(respondRequestParamsSchema, req.params);
    const result = await friendsService.cancel(req.auth!.sub, params.id);
    return reply.send(result);
  },

  async removeFriend(req: FastifyRequest, reply: FastifyReply) {
    const params = parse(removeFriendParamsSchema, req.params);
    const result = await friendsService.removeFriend(req.auth!.sub, params.userId);
    return reply.send(result);
  },

  async listFriends(req: FastifyRequest, reply: FastifyReply) {
    const query = parse(cursorQuerySchema, req.query ?? {});
    const result = await friendsService.listFriends(req.auth!.sub, query.cursor, query.limit ?? 20);
    return reply.send(result);
  },
};

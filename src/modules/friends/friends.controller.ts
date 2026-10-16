import type { FastifyReply, FastifyRequest } from 'fastify';
import { parse } from '../../core/validate.js';
import { friendsService } from './friends.service.js';
import {
  sendRequestSchema,
  respondRequestParamsSchema,
  removeFriendParamsSchema,
  cursorQuerySchema,
  friendProfileParamsSchema,
  friendSettingsSchema,
  reportSchema,
  blockParamsSchema,
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

  async getFriendProfile(req: FastifyRequest, reply: FastifyReply) {
    const params = parse(friendProfileParamsSchema, req.params);
    const result = await friendsService.getFriendProfile(req.auth!.sub, params.userId);
    return reply.send(result);
  },

  async leaderboard(req: FastifyRequest, reply: FastifyReply) {
    const result = await friendsService.leaderboard(req.auth!.sub);
    return reply.send(result);
  },

  async summary(req: FastifyRequest, reply: FastifyReply) {
    const result = await friendsService.summary(req.auth!.sub);
    return reply.send(result);
  },

  async getSettings(req: FastifyRequest, reply: FastifyReply) {
    const result = await friendsService.getSettings(req.auth!.sub);
    return reply.send(result);
  },

  async updateSettings(req: FastifyRequest, reply: FastifyReply) {
    const body = parse(friendSettingsSchema, req.body);
    const result = await friendsService.updateSettings(req.auth!.sub, body);
    return reply.send(result);
  },

  async block(req: FastifyRequest, reply: FastifyReply) {
    const params = parse(blockParamsSchema, req.params);
    const result = await friendsService.block(req.auth!.sub, params.userId);
    return reply.status(201).send(result);
  },

  async unblock(req: FastifyRequest, reply: FastifyReply) {
    const params = parse(blockParamsSchema, req.params);
    const result = await friendsService.unblock(req.auth!.sub, params.userId);
    return reply.send(result);
  },

  async listBlocks(req: FastifyRequest, reply: FastifyReply) {
    const result = await friendsService.listBlocks(req.auth!.sub);
    return reply.send(result);
  },

  async createReport(req: FastifyRequest, reply: FastifyReply) {
    const body = parse(reportSchema, req.body);
    const result = await friendsService.createReport(req.auth!.sub, body);
    return reply.status(201).send(result);
  },
};

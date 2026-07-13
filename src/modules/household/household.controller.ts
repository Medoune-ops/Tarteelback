import type { FastifyReply, FastifyRequest } from 'fastify';
import { parse } from '../../core/validate.js';
import { householdService } from './household.service.js';
import { inviteSchema, targetUserSchema } from './household.schemas.js';

export const householdController = {
  async get(req: FastifyRequest, reply: FastifyReply) {
    return reply.send(await householdService.getMine(req.auth!.sub));
  },

  async create(req: FastifyRequest, reply: FastifyReply) {
    return reply.send(await householdService.create(req.auth!.sub));
  },

  async remove(req: FastifyRequest, reply: FastifyReply) {
    return reply.send(await householdService.remove(req.auth!.sub));
  },

  async leave(req: FastifyRequest, reply: FastifyReply) {
    return reply.send(await householdService.leave(req.auth!.sub));
  },

  async transfer(req: FastifyRequest, reply: FastifyReply) {
    const body = parse(targetUserSchema, req.body ?? {});
    return reply.send(await householdService.transfer(req.auth!.sub, body.userId));
  },

  async invite(req: FastifyRequest, reply: FastifyReply) {
    const body = parse(inviteSchema, req.body ?? {});
    return reply.send(await householdService.invite(req.auth!.sub, body.email));
  },

  async accept(req: FastifyRequest, reply: FastifyReply) {
    const { token } = req.params as { token: string };
    return reply.send(await householdService.accept(req.auth!.sub, token));
  },

  async decline(req: FastifyRequest, reply: FastifyReply) {
    const { token } = req.params as { token: string };
    return reply.send(await householdService.decline(req.auth!.sub, token));
  },

  async cancelInvitation(req: FastifyRequest, reply: FastifyReply) {
    const { id } = req.params as { id: string };
    return reply.send(await householdService.cancelInvitation(req.auth!.sub, id));
  },

  async removeMember(req: FastifyRequest, reply: FastifyReply) {
    const { userId } = req.params as { userId: string };
    return reply.send(await householdService.removeMember(req.auth!.sub, userId));
  },
};

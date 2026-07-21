import type { FastifyReply, FastifyRequest } from 'fastify';
import { parse } from '../../core/validate.js';
import { adminUsersService } from './adminUsers.service.js';
import {
  listUsersQuerySchema,
  banUserSchema,
  grantHeartsSchema,
  grantGemsSchema,
  grantPremiumSchema,
} from './adminUsers.schemas.js';

const idParam = (req: FastifyRequest) => (req.params as { id: string }).id;

export const adminUsersController = {
  async list(req: FastifyRequest, reply: FastifyReply) {
    const query = parse(listUsersQuerySchema, req.query);
    return reply.send(await adminUsersService.list(query));
  },

  async ban(req: FastifyRequest, reply: FastifyReply) {
    const input = parse(banUserSchema, req.body ?? {});
    return reply.send(await adminUsersService.ban(idParam(req), input.reason));
  },

  async unban(req: FastifyRequest, reply: FastifyReply) {
    return reply.send(await adminUsersService.unban(idParam(req)));
  },

  async grantHearts(req: FastifyRequest, reply: FastifyReply) {
    const input = parse(grantHeartsSchema, req.body);
    return reply.send(await adminUsersService.grantHearts(idParam(req), input.amount));
  },

  async grantGems(req: FastifyRequest, reply: FastifyReply) {
    const input = parse(grantGemsSchema, req.body);
    return reply.send(await adminUsersService.grantGems(idParam(req), input.amount));
  },

  async grantPremium(req: FastifyRequest, reply: FastifyReply) {
    const input = parse(grantPremiumSchema, req.body);
    return reply.send(await adminUsersService.grantPremium(idParam(req), input.durationDays));
  },

  async revokeGrantedPremium(req: FastifyRequest, reply: FastifyReply) {
    return reply.send(await adminUsersService.revokeGrantedPremium(idParam(req)));
  },
};

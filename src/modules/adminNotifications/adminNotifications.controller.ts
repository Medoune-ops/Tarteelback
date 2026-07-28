import type { FastifyReply, FastifyRequest } from 'fastify';
import { parse } from '../../core/validate.js';
import { adminNotificationsService } from './adminNotifications.service.js';
import { broadcastSchema, historyQuerySchema } from './adminNotifications.schemas.js';

export const adminNotificationsController = {
  async broadcast(req: FastifyRequest, reply: FastifyReply) {
    const input = parse(broadcastSchema, req.body);
    return reply.send(await adminNotificationsService.broadcast(req.adminAuth!.sub, input));
  },

  async history(req: FastifyRequest, reply: FastifyReply) {
    const query = parse(historyQuerySchema, req.query);
    return reply.send(await adminNotificationsService.history(query.limit));
  },
};

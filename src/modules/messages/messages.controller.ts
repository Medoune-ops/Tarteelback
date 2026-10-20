import type { FastifyReply, FastifyRequest } from 'fastify';
import { parse } from '../../core/validate.js';
import { messagesService } from './messages.service.js';
import {
  messageSendSchema,
  messageReadParamsSchema,
  messageListQuerySchema,
} from './messages.schemas.js';

export const messagesController = {
  async send(req: FastifyRequest, reply: FastifyReply) {
    const body = parse(messageSendSchema, req.body);
    const result = await messagesService.send(req.auth!.sub, body);
    return reply.status(201).send(result);
  },
  async list(req: FastifyRequest, reply: FastifyReply) {
    const query = parse(messageListQuerySchema, req.query ?? {});
    const result = await messagesService.list(
      req.auth!.sub,
      query.cursor,
      query.limit,
    );
    return reply.send(result);
  },
  async read(req: FastifyRequest, reply: FastifyReply) {
    const params = parse(messageReadParamsSchema, req.params);
    const result = await messagesService.read(req.auth!.sub, params.id);
    return reply.send(result);
  },
  async remove(req: FastifyRequest, reply: FastifyReply) {
    const params = parse(messageReadParamsSchema, req.params);
    const result = await messagesService.remove(req.auth!.sub, params.id);
    return reply.send(result);
  },
};

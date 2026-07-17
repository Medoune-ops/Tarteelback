import type { FastifyReply, FastifyRequest } from 'fastify';
import { parse } from '../../core/validate.js';
import { adminMonetisationService } from './adminMonetisation.service.js';
import { listTransactionsQuerySchema } from './adminMonetisation.schemas.js';

export const adminMonetisationController = {
  async summary(_req: FastifyRequest, reply: FastifyReply) {
    return reply.send(await adminMonetisationService.summary());
  },

  async listTransactions(req: FastifyRequest, reply: FastifyReply) {
    const query = parse(listTransactionsQuerySchema, req.query);
    return reply.send(await adminMonetisationService.listTransactions(query));
  },
};

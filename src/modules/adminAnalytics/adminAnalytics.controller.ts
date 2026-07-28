import type { FastifyReply, FastifyRequest } from 'fastify';
import { parse } from '../../core/validate.js';
import { adminAnalyticsService } from './adminAnalytics.service.js';
import {
  signupsTimeseriesQuerySchema, topStreaksQuerySchema,
  requestsTimeseriesQuerySchema, requestsMonthlyQuerySchema,
} from './adminAnalytics.schemas.js';

export const adminAnalyticsController = {
  async summary(_req: FastifyRequest, reply: FastifyReply) {
    return reply.send(await adminAnalyticsService.summary());
  },

  async signupsTimeseries(req: FastifyRequest, reply: FastifyReply) {
    const query = parse(signupsTimeseriesQuerySchema, req.query);
    return reply.send({ series: await adminAnalyticsService.signupsTimeseries(query.days) });
  },

  async requestsTimeseries(req: FastifyRequest, reply: FastifyReply) {
    const query = parse(requestsTimeseriesQuerySchema, req.query);
    return reply.send({ series: await adminAnalyticsService.requestsPerDay(query.days) });
  },

  async requestsMonthly(req: FastifyRequest, reply: FastifyReply) {
    const query = parse(requestsMonthlyQuerySchema, req.query);
    return reply.send({ series: await adminAnalyticsService.requestsPerMonth(query.months) });
  },

  async topStreaks(req: FastifyRequest, reply: FastifyReply) {
    const query = parse(topStreaksQuerySchema, req.query);
    return reply.send({ users: await adminAnalyticsService.topStreaks(query.limit) });
  },
};

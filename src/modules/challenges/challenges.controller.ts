import type { FastifyReply, FastifyRequest } from 'fastify';
import { parse } from '../../core/validate.js';
import { challengesService } from './challenges.service.js';
import {
  challengePreviewSchema,
  challengeCreateSchema,
  challengeListQuerySchema,
  challengeParamsSchema,
} from './challenges.schemas.js';

export const challengesController = {
  async preview(req: FastifyRequest, reply: FastifyReply) {
    const body = parse(challengePreviewSchema, req.body);
    const result = await challengesService.preview(req.auth!.sub, body as any);
    return reply.send(result);
  },
  async create(req: FastifyRequest, reply: FastifyReply) {
    const body = parse(challengeCreateSchema, req.body);
    const result = await challengesService.create(req.auth!.sub, body as any);
    return reply.status(201).send(result);
  },
  async list(req: FastifyRequest, reply: FastifyReply) {
    const query = parse(challengeListQuerySchema, req.query ?? {});
    const result = await challengesService.list(req.auth!.sub, query.status, query.cursor, query.limit ?? 20);
    return reply.send(result);
  },
  async get(req: FastifyRequest, reply: FastifyReply) {
    const params = parse(challengeParamsSchema, req.params);
    const result = await challengesService.get(req.auth!.sub, params.id);
    return reply.send(result);
  },
};
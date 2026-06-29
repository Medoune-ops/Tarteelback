import type { FastifyReply, FastifyRequest } from 'fastify';
import { parse } from '../../core/validate.js';
import { lessonService } from './lesson.service.js';
import { answerSchema, completeSchema } from './lesson.schemas.js';

export const lessonController = {
  async answer(req: FastifyRequest, reply: FastifyReply) {
    const { id, stepId } = req.params as { id: string; stepId: string };
    const body = parse(answerSchema, req.body ?? {});
    const result = await lessonService.answer(req.auth!.sub, id, stepId, body);
    return reply.send(result);
  },

  async complete(req: FastifyRequest, reply: FastifyReply) {
    const { id } = req.params as { id: string };
    const body = parse(completeSchema, req.body ?? {});
    // Optional score percentage hint, for LessonProgress.score.
    const score =
      typeof body.correctCount === 'number' && typeof body.totalTests === 'number' && body.totalTests > 0
        ? Math.round((body.correctCount / body.totalTests) * 100)
        : undefined;
    const result = await lessonService.complete(req.auth!.sub, id, body.correctCount, score);
    return reply.send(result);
  },
};

import type { FastifyReply, FastifyRequest } from 'fastify';
import { parse } from '../../core/validate.js';
import { AppError } from '../../core/errors.js';
import { lessonService } from './lesson.service.js';
import { answerSchema, completeSchema, completeFlatSchema } from './lesson.schemas.js';

export const lessonController = {
  async answer(req: FastifyRequest, reply: FastifyReply) {
    const { id, stepId } = req.params as { id: string; stepId: string };
    const body = parse(answerSchema, req.body ?? {});
    const result = await lessonService.answer(req.auth!.sub, id, stepId, body);
    return reply.send(result);
  },

  /**
   * POST /lessons/:id/steps/:stepId/answer-voice — multipart upload of the raw
   * recording (field `audio`). Server-side ASR + scoring; may cost a heart.
   */
  async answerVoice(req: FastifyRequest, reply: FastifyReply) {
    const { id, stepId } = req.params as { id: string; stepId: string };
    const file = await req.file();
    if (!file) {
      throw new AppError('VALIDATION_ERROR', 'Multipart field "audio" is required');
    }
    // toBuffer() enforces the multipart fileSize limit (throws if exceeded).
    const audio = await file.toBuffer();
    const result = await lessonService.answerVoice(
      req.auth!.sub,
      id,
      stepId,
      audio,
      file.filename || 'recording',
      file.mimetype || 'application/octet-stream',
    );
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

  /**
   * POST /lesson/complete (flat contract for the RN store). Takes lessonId in
   * the body, returns the full flat /me shape for hydrateFromBackend.
   */
  async completeFlat(req: FastifyRequest, reply: FastifyReply) {
    const body = parse(completeFlatSchema, req.body ?? {});
    const score =
      typeof body.correctAnswers === 'number' &&
      typeof body.totalAnswers === 'number' &&
      body.totalAnswers > 0
        ? Math.round((body.correctAnswers / body.totalAnswers) * 100)
        : undefined;
    const flat = await lessonService.completeFlat(
      req.auth!.sub,
      body.lessonId,
      body.correctAnswers,
      score,
    );
    return reply.send(flat);
  },
};

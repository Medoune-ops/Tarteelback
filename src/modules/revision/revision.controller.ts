import type { FastifyReply, FastifyRequest } from 'fastify';
import { parse } from '../../core/validate.js';
import { AppError } from '../../core/errors.js';
import { revisionService } from './revision.service.js';
import { reviewSchema } from './revision.schemas.js';

export const revisionController = {
  async list(req: FastifyRequest, reply: FastifyReply) {
    const result = await revisionService.list(req.auth!.sub);
    return reply.send(result);
  },

  async review(req: FastifyRequest, reply: FastifyReply) {
    const { idOrNumero } = req.params as { idOrNumero: string };
    const body = parse(reviewSchema, req.body ?? {});
    const result = await revisionService.review(req.auth!.sub, idOrNumero, body.quality);
    return reply.send(result);
  },

  async listLettres(req: FastifyRequest, reply: FastifyReply) {
    const result = await revisionService.listLettres(req.auth!.sub);
    return reply.send(result);
  },

  async reviewLettre(req: FastifyRequest, reply: FastifyReply) {
    const { lessonId } = req.params as { lessonId: string };
    const body = parse(reviewSchema, req.body ?? {});
    const result = await revisionService.reviewLettre(req.auth!.sub, lessonId, body.quality);
    return reply.send(result);
  },

  /**
   * POST /me/revisions/versets/:versetId/recite — multipart upload de
   * l'enregistrement (champ `audio`). ASR serveur + scoring ; jamais de cœur.
   */
  async recite(req: FastifyRequest, reply: FastifyReply) {
    const { versetId } = req.params as { versetId: string };
    const file = await req.file();
    if (!file) {
      throw new AppError('VALIDATION_ERROR', 'Multipart field "audio" is required');
    }
    const audio = await file.toBuffer();
    const result = await revisionService.reciteVerset(
      versetId,
      audio,
      file.filename || 'recording',
      file.mimetype || 'application/octet-stream',
    );
    return reply.send(result);
  },
};

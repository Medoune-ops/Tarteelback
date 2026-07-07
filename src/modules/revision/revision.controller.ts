import type { FastifyReply, FastifyRequest } from 'fastify';
import { AppError } from '../../core/errors.js';
import { revisionService } from './revision.service.js';

export const revisionController = {
  /**
   * POST /revision/versets/:versetId/recite — multipart upload of the raw
   * recording (field `audio`). Server-side ASR + scoring; never costs a heart.
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

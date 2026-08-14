import type { FastifyReply, FastifyRequest } from 'fastify';
import { AppError } from '../../core/errors.js';
import { audioService } from './audio.service.js';

export const audioController = {
  async manifest(_req: FastifyRequest, reply: FastifyReply) {
    return reply.send(await audioService.getManifest());
  },

  async file(req: FastifyRequest, reply: FastifyReply) {
    const { numero } = req.params as { numero: string };
    const n = Number(numero);
    if (!Number.isInteger(n) || n < 1 || n > 114) {
      throw new AppError('VALIDATION_ERROR', 'numero must be an integer between 1 and 114');
    }
    const stream = await audioService.getFileStream(n);
    reply.header('Content-Type', 'audio/mpeg');
    return reply.send(stream);
  },
};

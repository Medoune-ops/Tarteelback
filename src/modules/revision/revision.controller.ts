import type { FastifyReply, FastifyRequest } from 'fastify';
import { parse } from '../../core/validate.js';
import { AppError } from '../../core/errors.js';
import { env } from '../../config/env.js';
import { resolveLang } from '../../core/optionalAuth.js';
import { revisionService } from './revision.service.js';
import { reviewSchema, guidedAdvanceSchema } from './revision.schemas.js';

export const revisionController = {
  async list(req: FastifyRequest, reply: FastifyReply) {
    const result = await revisionService.list(req.auth!.sub);
    return reply.send(result);
  },

  async getSegments(req: FastifyRequest, reply: FastifyReply) {
    const { idOrNumero } = req.params as { idOrNumero: string };
    const result = await revisionService.getSegments(req.auth!.sub, idOrNumero);
    return reply.send(result);
  },

  async reviewSegment(req: FastifyRequest, reply: FastifyReply) {
    const { idOrNumero, segmentIndex } = req.params as { idOrNumero: string; segmentIndex: string };
    const body = parse(reviewSchema, req.body ?? {});
    const result = await revisionService.reviewSegment(
      req.auth!.sub,
      idOrNumero,
      Number(segmentIndex),
      body.quality,
    );
    return reply.send(result);
  },

  async getGuided(req: FastifyRequest, reply: FastifyReply) {
    const { idOrNumero } = req.params as { idOrNumero: string };
    const result = await revisionService.getGuided(req.auth!.sub, idOrNumero);
    return reply.send(result);
  },

  async advanceGuided(req: FastifyRequest, reply: FastifyReply) {
    const { idOrNumero } = req.params as { idOrNumero: string };
    const body = parse(guidedAdvanceSchema, req.body ?? {});
    const result = await revisionService.advanceGuided(req.auth!.sub, idOrNumero, body.quality);
    return reply.send(result);
  },

  async listLettres(req: FastifyRequest, reply: FastifyReply) {
    const lang = resolveLang(req, env.DEFAULT_LANG);
    const result = await revisionService.listLettres(req.auth!.sub, lang, env.DEFAULT_LANG);
    return reply.send(result);
  },

  async reviewLettre(req: FastifyRequest, reply: FastifyReply) {
    const { lessonId } = req.params as { lessonId: string };
    const body = parse(reviewSchema, req.body ?? {});
    const lang = resolveLang(req, env.DEFAULT_LANG);
    const result = await revisionService.reviewLettre(req.auth!.sub, lessonId, body.quality, lang, env.DEFAULT_LANG);
    return reply.send(result);
  },

  /**
   * POST /me/revisions/lettres/steps/:stepId/recite — multipart upload de la
   * prononciation d'une lettre/syllabe (champ `audio`). ASR + scoring serveur.
   */
  async reciteLettre(req: FastifyRequest, reply: FastifyReply) {
    const { stepId } = req.params as { stepId: string };
    const file = await req.file();
    if (!file) {
      throw new AppError('VALIDATION_ERROR', 'Multipart field "audio" is required');
    }
    const audio = await file.toBuffer();
    const result = await revisionService.reciteLettreStep(
      stepId,
      audio,
      file.filename || 'recording',
      file.mimetype || 'application/octet-stream',
    );
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

  /**
   * POST /me/revisions/lettres/:lessonId/recite-range?debut=&fin= —
   * prononciation assemblée de plusieurs lettres/syllabes consécutives d'une
   * leçon alphabet (exercice de chaînage, `debut`/`fin` = ordre des steps).
   */
  async reciteLettreRange(req: FastifyRequest, reply: FastifyReply) {
    const { lessonId } = req.params as { lessonId: string };
    const { debut, fin } = req.query as { debut?: string; fin?: string };
    const file = await req.file();
    if (!file) {
      throw new AppError('VALIDATION_ERROR', 'Multipart field "audio" is required');
    }
    const audio = await file.toBuffer();
    const result = await revisionService.reciteLettreRange(
      lessonId,
      Number(debut),
      Number(fin),
      audio,
      file.filename || 'recording',
      file.mimetype || 'application/octet-stream',
    );
    return reply.send(result);
  },

  /**
   * POST /me/revisions/:idOrNumero/recite-range?debut=&fin= — récitation
   * assemblée de plusieurs versets consécutifs (exercice de chaînage).
   */
  async reciteRange(req: FastifyRequest, reply: FastifyReply) {
    const { idOrNumero } = req.params as { idOrNumero: string };
    const { debut, fin } = req.query as { debut?: string; fin?: string };
    const file = await req.file();
    if (!file) {
      throw new AppError('VALIDATION_ERROR', 'Multipart field "audio" is required');
    }
    const audio = await file.toBuffer();
    const result = await revisionService.reciteVersetRange(
      idOrNumero,
      Number(debut),
      Number(fin),
      audio,
      file.filename || 'recording',
      file.mimetype || 'application/octet-stream',
    );
    return reply.send(result);
  },
};

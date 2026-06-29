import fp from 'fastify-plugin';
import type { FastifyError } from 'fastify';
import { ZodError } from 'zod';
import { Prisma } from '@prisma/client';
import { AppError } from '../core/errors.js';
import { isProd } from '../config/env.js';

/** Translate a Prisma error into our AppError contract, or null if unknown. */
function mapPrismaError(err: unknown): AppError | null {
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    switch (err.code) {
      case 'P2002': // unique constraint (e.g. concurrent duplicate register)
        return new AppError('CONFLICT', 'Resource already exists');
      case 'P2025': // record not found for update/delete
        return new AppError('NOT_FOUND', 'Resource not found');
      case 'P2003': // foreign key constraint
        return new AppError('VALIDATION_ERROR', 'Related resource does not exist');
      default:
        return null;
    }
  }
  // DB unreachable / pool exhausted / connection issues → 503-style.
  if (
    err instanceof Prisma.PrismaClientInitializationError ||
    err instanceof Prisma.PrismaClientRustPanicError
  ) {
    return new AppError('SERVICE_UNAVAILABLE', 'Service temporarily unavailable');
  }
  return null;
}

/**
 * Uniform error envelope for every failure:
 *   { error: { code, message, details? } }
 * The RN front switches on `error.code`.
 */
export default fp(async (app) => {
  app.setErrorHandler((err: FastifyError | Error, req, reply) => {
    // Our typed application errors.
    if (err instanceof AppError) {
      return reply.status(err.statusCode).send({
        error: { code: err.code, message: err.message, details: err.details },
      });
    }

    // Known Prisma errors → proper status codes (not opaque 500s).
    const prismaMapped = mapPrismaError(err);
    if (prismaMapped) {
      if (prismaMapped.statusCode >= 500) req.log.error({ err }, 'Prisma error');
      return reply.status(prismaMapped.statusCode).send({
        error: { code: prismaMapped.code, message: prismaMapped.message },
      });
    }

    // Zod validation errors (from manual parsing in controllers).
    if (err instanceof ZodError) {
      return reply.status(400).send({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid input',
          details: err.flatten(),
        },
      });
    }

    // Fastify's built-in rate-limit error.
    if ((err as { statusCode?: number }).statusCode === 429) {
      return reply.status(429).send({
        error: { code: 'RATE_LIMITED', message: 'Too many requests, slow down' },
      });
    }

    // Fastify schema validation (querystring/params).
    if ((err as { validation?: unknown }).validation) {
      return reply.status(400).send({
        error: {
          code: 'VALIDATION_ERROR',
          message: err.message,
          details: (err as { validation?: unknown }).validation,
        },
      });
    }

    // Unknown / unexpected.
    req.log.error({ err }, 'Unhandled error');
    return reply.status(500).send({
      error: {
        code: 'INTERNAL',
        message: isProd ? 'Internal server error' : err.message,
      },
    });
  });

  app.setNotFoundHandler((req, reply) => {
    reply.status(404).send({
      error: { code: 'NOT_FOUND', message: `Route ${req.method} ${req.url} not found` },
    });
  });
});

import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import { env, isProd, isTest } from './config/env.js';
import { prisma } from './config/prisma.js';
import { redis } from './config/redis.js';
import authPlugin from './plugins/auth.js';
import errorHandler from './plugins/errorHandler.js';
import { registerRoutes } from './routes.js';

/**
 * Build (but do not start) the Fastify app. Reusable by tests via app.inject().
 */
export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({
    logger: isProd
      ? { level: 'info' }
      : { level: 'info' },
    // In prod, request logging is noisy/costly at high RPS — keep it off and
    // rely on metrics + error logs (the error handler logs 500s explicitly).
    disableRequestLogging: isProd,
    // Trust the proxy/load balancer so client IPs (and thus rate-limit keys)
    // are correct behind an LB. Configure the LB to set X-Forwarded-For.
    trustProxy: true,
    // Cap request bodies to blunt large-payload DoS (auth/game bodies are tiny;
    // admin verse text is the largest legitimate payload).
    bodyLimit: 256 * 1024, // 256 KiB
  });

  // ── Security headers (HSTS, nosniff, frameguard, etc.) ──
  await app.register(helmet, {
    // Swagger UI (dev only) needs a relaxed CSP; the API itself serves JSON.
    contentSecurityPolicy: isProd ? undefined : false,
  });

  // ── CORS ──
  // Never combine origin reflection with credentials. This is a mobile API:
  // browsers aren't the primary client, so we don't send credentials, and in
  // production a wildcard origin is rejected at boot (see env.ts).
  const origins = env.CORS_ORIGINS.split(',').map((o) => o.trim());
  const allowAll = origins.includes('*');
  await app.register(cors, {
    origin: allowAll ? true : origins,
    credentials: false,
  });

  // ── Global rate limit. Uses Redis when configured so the limit is shared
  // across all instances behind the load balancer; otherwise in-memory
  // (correct for a single instance). Keying via trustProxy/IP.
  // In tests, the cap is raised so the shared Redis bucket isn't exhausted by
  // the whole suite hitting auth from one IP. ──
  await app.register(rateLimit, {
    max: isTest ? 100_000 : 300,
    timeWindow: '1 minute',
    addHeaders: { 'retry-after': true },
    ...(redis ? { redis } : {}),
  });

  // ── OpenAPI / Swagger — only outside production (don't publish the API map). ──
  if (!isProd) {
  await app.register(swagger, {
    openapi: {
      info: {
        title: 'Tarteel API',
        description:
          'Custom backend for Tarteel — a Quran-learning app. All game rules ' +
          '(hearts, streak, premium, leagues) are enforced server-side.',
        version: '1.0.0',
      },
      servers: [{ url: `http://localhost:${env.PORT}` }],
      components: {
        securitySchemes: {
          bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
        },
      },
      tags: [
        { name: 'auth', description: 'Authentication & persistent sessions' },
        { name: 'me', description: 'Current user, hearts, streak' },
        { name: 'content', description: 'Sections, lessons, sourates, versets' },
        { name: 'admin', description: 'Content management (admin only)' },
        { name: 'lessons', description: 'Lesson engine & hearts' },
        { name: 'leagues', description: 'Leagues & ranking' },
        { name: 'billing', description: 'Premium & streak repair (mock)' },
        { name: 'notifications', description: 'Push tokens & preferences' },
        { name: 'rewards', description: 'Streak goal, podiums, daily chest' },
      ],
    },
  });
    await app.register(swaggerUi, { routePrefix: '/docs' });
  }

  // ── Core plugins ──
  await app.register(errorHandler);
  await app.register(authPlugin);

  // ── Liveness: cheap, never touches the DB (is the process up?). ──
  app.get('/health', { logLevel: 'warn' }, async () => ({
    status: 'ok',
    time: new Date().toISOString(),
  }));

  // ── Readiness: used by the load balancer to route traffic only when the DB
  // is reachable. Returns 503 if the DB is down. ──
  app.get('/ready', { logLevel: 'warn' }, async (_req, reply) => {
    try {
      await prisma.$queryRaw`SELECT 1`;
      return { status: 'ready' };
    } catch {
      return reply.status(503).send({
        error: { code: 'INTERNAL', message: 'Database not reachable' },
      });
    }
  });

  // ── Feature routes ──
  await app.register(registerRoutes);

  return app;
}

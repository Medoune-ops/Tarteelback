import type { FastifyInstance } from 'fastify';
import { gemController } from './gem.controller.js';

/**
 * Gem economy routes (server-authoritative sinks) + the free review→heart
 * gate. Mounted under /me. All authed. Earnings happen implicitly (lesson
 * complete, streak, league promotion) — there is no "earn gems" endpoint.
 */
export async function gemRoutes(app: FastifyInstance) {
  app.addHook('preHandler', app.authenticate);
  const sec = { tags: ['gems'] as const, security: [{ bearerAuth: [] }] };

  app.get('/gems', { schema: { ...sec, summary: 'Gem balance + recent ledger' } }, gemController.status);

  // Hearts=0 exit doors (spec order: review first, then wait, then gems).
  app.post('/hearts/review-regain', { schema: { ...sec, summary: 'Completed review session → +1 heart (max 2/day, free)' } }, gemController.reviewRegainHeart);
  app.post('/hearts/refill', { schema: { ...sec, summary: 'Instant refill to 5 hearts (350 gems)' } }, gemController.refillHearts);

  app.post('/streak-freezes', { schema: { ...sec, summary: 'Buy one streak freeze (200 gems, max 2 held)' } }, gemController.buyStreakFreeze);
  app.post('/boosts/double-xp', { schema: { ...sec, summary: 'Double XP for 15 minutes (100 gems)' } }, gemController.buyDoubleXp);
}

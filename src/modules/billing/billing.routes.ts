import type { FastifyInstance } from 'fastify';
import { billingController } from './billing.controller.js';

/** Billing (mock provider). `repair-streak` lives here too, per the spec. */
export async function billingRoutes(app: FastifyInstance) {
  app.addHook('preHandler', app.authenticate);
  const sec = { tags: ['billing'] as const, security: [{ bearerAuth: [] }] };

  app.post('/subscribe', { schema: { ...sec, summary: 'Activate premium (mock payment)' } }, billingController.subscribe);
  app.get('/status', { schema: { ...sec, summary: 'Premium status & transactions' } }, billingController.status);
  app.post('/repair-streak', { schema: { ...sec, summary: 'Pay to restore the broken streak' } }, billingController.repairStreak);
  app.post('/gems', { schema: { ...sec, summary: 'Buy a gem pack (mock payment)' } }, billingController.buyGems);
}

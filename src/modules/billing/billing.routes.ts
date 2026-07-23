import type { FastifyInstance } from 'fastify';
import { billingController } from './billing.controller.js';

/**
 * Billing (paiement carte via DexPay, popup SDK). Ces routes créent une
 * checkout session et renvoient `paymentUrl` — elles ne créditent RIEN
 * elles-mêmes (voir billing.service.ts). `repair-streak` vit ici aussi, per
 * the spec. Le webhook DexPay (dexpay.webhook.ts) est monté SÉPARÉMENT
 * (routes.ts) car il ne doit PAS exiger de Bearer token.
 */
export async function billingRoutes(app: FastifyInstance) {
  app.addHook('preHandler', app.authenticate);
  const sec = { tags: ['billing'] as const, security: [{ bearerAuth: [] }] };

  app.post('/subscribe', { schema: { ...sec, summary: 'Create a DexPay checkout session to activate premium' } }, billingController.subscribe);
  app.get('/status', { schema: { ...sec, summary: 'Premium status & transactions' } }, billingController.status);
  app.post('/cancel', { schema: { ...sec, summary: "Cancel this account's personal premium subscription" } }, billingController.cancelSubscription);
  app.get('/transactions/:reference', { schema: { ...sec, summary: 'Poll a payment status by reference' } }, billingController.getTransaction);
  app.post('/repair-streak', { schema: { ...sec, summary: 'Create a DexPay checkout session to restore the broken streak' } }, billingController.repairStreak);
  app.post('/gems', { schema: { ...sec, summary: 'Create a DexPay checkout session to buy a gem pack' } }, billingController.buyGems);
  app.post('/hearts', { schema: { ...sec, summary: 'Create a DexPay checkout session to buy a full heart refill' } }, billingController.buyHearts);
}

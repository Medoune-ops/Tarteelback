import type { FastifyInstance } from 'fastify';
import { billingController } from './billing.controller.js';

/**
 * Billing (paiement via DexPay [mobile money] ou Stripe [carte, mondial],
 * choisi par `provider` dans le body). Ces routes créent une checkout session
 * et renvoient `paymentUrl` — elles ne créditent RIEN elles-mêmes (voir
 * billing.service.ts). `repair-streak` vit ici aussi, per the spec. Les
 * webhooks (dexpay.webhook.ts / stripe.webhook.ts) sont montés SÉPARÉMENT
 * (routes.ts) car ils ne doivent PAS exiger de Bearer token.
 */
export async function billingRoutes(app: FastifyInstance) {
  app.addHook('preHandler', app.authenticate);
  const sec = { tags: ['billing'] as const, security: [{ bearerAuth: [] }] };

  app.post('/subscribe', { schema: { ...sec, summary: 'Create a checkout session (DexPay or Stripe) to activate premium' } }, billingController.subscribe);
  app.get('/status', { schema: { ...sec, summary: 'Premium status & transactions' } }, billingController.status);
  app.get('/transactions/:reference', { schema: { ...sec, summary: 'Poll a payment status by reference' } }, billingController.getTransaction);
  app.post('/repair-streak', { schema: { ...sec, summary: 'Create a checkout session (DexPay or Stripe) to restore the broken streak' } }, billingController.repairStreak);
  app.post('/gems', { schema: { ...sec, summary: 'Create a checkout session (DexPay or Stripe) to buy a gem pack' } }, billingController.buyGems);
  app.post('/hearts', { schema: { ...sec, summary: 'Create a checkout session (DexPay or Stripe) to buy a full heart refill' } }, billingController.buyHearts);
}

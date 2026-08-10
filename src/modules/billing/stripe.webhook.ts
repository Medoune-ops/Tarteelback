import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type Stripe from 'stripe';
import { constructStripeEvent } from './stripe.client.js';
import { applyPaidTransaction, markTransactionFailed } from './billing.service.js';

/**
 * Webhook Stripe — POST /billing/webhooks/stripe.
 *
 * La signature (header `stripe-signature`) DOIT être vérifiée sur le corps
 * BRUT (bytes exacts reçus), jamais le JSON reparsé — même contrainte que
 * DexPay (voir dexpay.webhook.ts). D'où le parser de contenu custom ci-dessous,
 * scopé à ce plugin uniquement.
 */
async function handleWebhook(req: FastifyRequest, reply: FastifyReply) {
  const signature = req.headers['stripe-signature'] as string | undefined;
  if (!signature) {
    return reply.code(400).send({ error: { code: 'VALIDATION_ERROR', message: 'Missing stripe-signature header' } });
  }

  let event: Stripe.Event;
  try {
    event = constructStripeEvent(req.body as Buffer, signature);
  } catch (e) {
    console.error('[stripe webhook] signature verification failed:', e);
    return reply.code(401).send({ error: { code: 'UNAUTHENTICATED', message: 'Invalid webhook signature' } });
  }

  // Répondre vite (recommandation Stripe) : le traitement ci-dessous est déjà
  // rapide (quelques requêtes DB indexées par `reference` unique).
  if (event.type === 'checkout.session.completed') {
    const session = event.data.object as Stripe.Checkout.Session;
    const reference = session.client_reference_id ?? session.metadata?.reference;
    if (reference) await applyPaidTransaction(reference);
  } else if (event.type === 'checkout.session.expired') {
    const session = event.data.object as Stripe.Checkout.Session;
    const reference = session.client_reference_id ?? session.metadata?.reference;
    if (reference) await markTransactionFailed(reference);
  }
  // Autres événements (payment_intent.*, charge.*…) : no-op — la Transaction
  // est déjà créée `pending` par billing.service.ts au moment de
  // createStripeCheckoutSession, checkout.session.completed suffit à confirmer.

  return reply.code(200).send({ received: true });
}

export async function stripeWebhookRoutes(app: FastifyInstance) {
  // Parser custom scopé à CE plugin (register() encapsule chaque plugin dans
  // son propre scope Fastify) : capture le Buffer brut au lieu du JSON parsé,
  // indispensable pour vérifier la signature sur les bytes exacts — même
  // pattern que dexpayWebhookRoutes, dans son propre scope isolé.
  app.addContentTypeParser('application/json', { parseAs: 'buffer' }, (_req, body, done) => {
    done(null, body);
  });

  app.post(
    '/webhooks/stripe',
    { schema: { tags: ['billing'], summary: 'Webhook Stripe (signature vérifiée)' } },
    handleWebhook,
  );
}

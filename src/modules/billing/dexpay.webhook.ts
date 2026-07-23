import crypto from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { env } from '../../config/env.js';
import { applyPaidTransaction, markTransactionFailed } from './billing.service.js';

/**
 * Webhook DexPay — POST /billing/webhooks/dexpay.
 *
 * La signature HMAC-SHA256 (header `X-Webhook-Signature`, algo confirmé dans
 * la doc "Webhooks" ; la page "Architecture" mentionne aussi `x-dexchange-
 * signature` — on accepte les DEUX noms de header pour ne pas dépendre d'une
 * incohérence de la doc elle-même) DOIT être calculée sur le corps BRUT
 * (bytes exacts reçus), jamais sur le JSON reparsé (l'ordre des clés/espaces
 * peuvent différer) — voir doc "Guide des remboursements". D'où le parser de
 * contenu custom ci-dessous, scopé à CE plugin uniquement : il capture le
 * buffer brut au lieu de laisser le parser JSON par défaut de Fastify le
 * consommer avant nous.
 */

interface DexpayWebhookPayload {
  event: string;
  reference?: string;
  data?: { reference?: string };
}

function verifySignature(rawBody: string, signature: string | undefined, secret: string): boolean {
  if (!signature) return false;
  const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
  // Longueurs différentes -> timingSafeEqual jetterait ; c'est un rejet légitime.
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

async function handleWebhook(req: FastifyRequest, reply: FastifyReply) {
  if (!env.DEXPAY_WEBHOOK_SECRET) {
    return reply.code(503).send({ error: { code: 'SERVICE_UNAVAILABLE', message: 'Webhook not configured' } });
  }

  const rawBody = (req.body as Buffer).toString('utf8');
  const signature =
    (req.headers['x-webhook-signature'] as string | undefined) ??
    (req.headers['x-dexchange-signature'] as string | undefined);

  if (!verifySignature(rawBody, signature, env.DEXPAY_WEBHOOK_SECRET)) {
    return reply.code(401).send({ error: { code: 'UNAUTHENTICATED', message: 'Invalid webhook signature' } });
  }

  let payload: DexpayWebhookPayload;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return reply.code(400).send({ error: { code: 'VALIDATION_ERROR', message: 'Invalid JSON body' } });
  }

  // Répondre vite (recommandation DexPay) : le traitement ci-dessous est déjà
  // rapide (quelques requêtes DB indexées par `reference` unique), pas besoin
  // de file d'attente séparée à ce volume.
  const reference = payload.reference ?? payload.data?.reference;
  if (reference) {
    if (payload.event === 'checkout.completed') {
      await applyPaidTransaction(reference);
    } else if (payload.event === 'checkout.failed' || payload.event === 'checkout.cancelled') {
      await markTransactionFailed(reference);
    }
    // checkout.initiated / checkout.refunded / événements inconnus : no-op —
    // la Transaction est déjà créée `pending` par billing.service.ts au
    // moment de l'appel createCheckoutSession, et refund n'est pas exposé
    // pour l'instant (déclenché manuellement, pas de flux d'annulation user).
  }

  return reply.code(200).send({ received: true });
}

export async function dexpayWebhookRoutes(app: FastifyInstance) {
  // Parser custom scopé à ce plugin : capture le Buffer brut au lieu du JSON
  // parsé, indispensable pour vérifier la signature HMAC sur les bytes exacts.
  app.addContentTypeParser('application/json', { parseAs: 'buffer' }, (_req, body, done) => {
    done(null, body);
  });

  app.post(
    '/webhooks/dexpay',
    { schema: { tags: ['billing'], summary: 'Webhook DexPay (signature HMAC-SHA256 vérifiée)' } },
    handleWebhook,
  );
}

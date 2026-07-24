import crypto from 'node:crypto';
import { vi } from 'vitest';
import type { FastifyInstance } from 'fastify';

/**
 * Doit correspondre à DEXPAY_WEBHOOK_SECRET tel que réellement chargé par
 * l'app (config/env.ts) — jamais une constante en dur ici : .env peut
 * contenir soit un placeholder de test, soit la vraie valeur sandbox selon
 * l'environnement, et les deux doivent signer de façon identique à ce que
 * dexpay.webhook.ts vérifie.
 */
export const TEST_DEXPAY_WEBHOOK_SECRET = process.env.DEXPAY_WEBHOOK_SECRET ?? 'test_webhook_secret';

/** Mocks the DexPay checkout-sessions endpoint so tests never hit the network. */
export function mockDexpayOk() {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
    if (String(url).includes('/checkout-sessions')) {
      return new Response(
        JSON.stringify({
          status: 201,
          message: 'ok',
          data: {
            reference: 'REF', amount: 1000, currency: 'XOF',
            payment_url: 'https://pay.dexpay.africa/REF',
            expires_at: new Date().toISOString(), status: 'initiated', isSandbox: true,
          },
        }),
        { status: 201 },
      );
    }
    return new Response('not found', { status: 404 });
  });
}

/** Simulates DexPay calling back with a signed webhook event. */
export async function sendDexpayWebhook(app: FastifyInstance, event: string, reference: string) {
  const payload = JSON.stringify({ event, reference, status: event.split('.')[1] });
  const signature = crypto.createHmac('sha256', TEST_DEXPAY_WEBHOOK_SECRET).update(payload).digest('hex');
  return app.inject({
    method: 'POST',
    url: '/billing/webhooks/dexpay',
    headers: { 'content-type': 'application/json', 'x-webhook-signature': signature },
    payload,
  });
}

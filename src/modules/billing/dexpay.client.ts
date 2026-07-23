import { env } from '../../config/env.js';
import { AppError } from '../../core/errors.js';

/**
 * Client HTTP DEXPAY (DEXCHANGE PAY) — paiement carte uniquement (voir
 * billing.service.ts : le formulaire carte lui-même vit dans le SDK Checkout
 * JS côté front, JAMAIS côté serveur — sinon bascule PCI-DSS SAQ-D).
 *
 * `x-api-key` (clé publique) suffit pour créer/lire une checkout session ;
 * `x-api-secret` (clé privée) est requis en plus pour le remboursement.
 * Référence : docs.dexpay.africa.
 */

const DEXPAY_TIMEOUT_MS = 15_000;

export interface CreateCheckoutSessionInput {
  reference: string;
  itemName: string;
  /** Montant en unité mineure ENTIÈRE de `currency` (pas de décimales). */
  amount: number;
  currency: 'XOF' | 'XAF';
  successUrl: string;
  failureUrl: string;
  webhookUrl: string;
  metadata?: Record<string, unknown>;
}

export interface CheckoutSessionData {
  reference: string;
  amount: number;
  currency: string;
  payment_url: string;
  expires_at: string;
  status: string;
  isSandbox: boolean;
}

interface CheckoutSessionResponse {
  status: number;
  message: string;
  data: CheckoutSessionData;
}

export interface RefundResult {
  status: 'success' | 'failed';
  message: string;
  paymentAttemptId?: string;
  transactionId?: string;
}

function requireConfigured(): void {
  if (!env.DEXPAY_API_KEY) {
    throw new AppError('SERVICE_UNAVAILABLE', 'DexPay is not configured (DEXPAY_API_KEY missing)');
  }
}

/**
 * Crée une checkout session (paiement carte, mode popup — voir
 * lib/payments côté front pour l'ouverture du SDK avec `payment_url`).
 */
export async function createCheckoutSession(
  input: CreateCheckoutSessionInput,
): Promise<CheckoutSessionData> {
  requireConfigured();

  let res: Response;
  try {
    res = await fetch(`${env.DEXPAY_BASE_URL}/checkout-sessions`, {
      method: 'POST',
      headers: {
        'x-api-key': env.DEXPAY_API_KEY!,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        reference: input.reference,
        item_name: input.itemName,
        amount: input.amount,
        currency: input.currency,
        success_url: input.successUrl,
        failure_url: input.failureUrl,
        webhook_url: input.webhookUrl,
        metadata: input.metadata,
      }),
      signal: AbortSignal.timeout(DEXPAY_TIMEOUT_MS),
    });
  } catch {
    throw new AppError('SERVICE_UNAVAILABLE', 'DexPay unreachable');
  }

  if (!res.ok) {
    // Log le corps d'erreur DexPay (jamais la clé secrète) pour diagnostiquer
    // les 4xx (clé invalide, KYC non validé, domaine non autorisé, etc.)
    // sans avoir à deviner depuis le seul status code.
    const errBody = await res.text().catch(() => '<unreadable>');
    console.error(`[dexpay] checkout-sessions ${res.status}:`, errBody);
    throw new AppError('PAYMENT_FAILED', `DexPay refused the checkout session (${res.status})`);
  }

  let body: CheckoutSessionResponse;
  try {
    body = (await res.json()) as CheckoutSessionResponse;
  } catch {
    throw new AppError('SERVICE_UNAVAILABLE', 'DexPay returned an invalid response');
  }
  return body.data;
}

/**
 * Rembourse intégralement la dernière transaction réussie d'une checkout
 * session (pas de remboursement partiel — voir docs.dexpay.africa).
 * Nécessite la clé SECRÈTE (sk_live_/sk_test_), jamais exposée au front.
 */
export async function refundCheckoutSession(reference: string): Promise<RefundResult> {
  requireConfigured();
  if (!env.DEXPAY_API_SECRET) {
    throw new AppError('SERVICE_UNAVAILABLE', 'DexPay refund is not configured (DEXPAY_API_SECRET missing)');
  }

  let res: Response;
  try {
    res = await fetch(`${env.DEXPAY_BASE_URL}/checkout-sessions/refund/${encodeURIComponent(reference)}`, {
      method: 'POST',
      headers: {
        'x-api-key': env.DEXPAY_API_KEY!,
        'x-api-secret': env.DEXPAY_API_SECRET,
      },
      signal: AbortSignal.timeout(DEXPAY_TIMEOUT_MS),
    });
  } catch {
    throw new AppError('SERVICE_UNAVAILABLE', 'DexPay unreachable');
  }

  let body: RefundResult & { message?: string };
  try {
    body = (await res.json()) as RefundResult & { message?: string };
  } catch {
    throw new AppError('SERVICE_UNAVAILABLE', 'DexPay returned an invalid response');
  }

  if (!res.ok) {
    throw new AppError('PAYMENT_FAILED', body.message ?? `DexPay refund failed (${res.status})`);
  }
  return body;
}

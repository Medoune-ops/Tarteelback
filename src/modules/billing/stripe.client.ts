import Stripe from 'stripe';
import { env } from '../../config/env.js';
import { AppError } from '../../core/errors.js';

/**
 * Client Stripe — paiement CARTE BANCAIRE, couverture mondiale (complète
 * DexPay, qui ne couvre pas les cartes hors Afrique de l'Ouest/Centrale).
 * Utilise Stripe Checkout (page hébergée Stripe), même logique que DexPay :
 * le formulaire carte vit chez Stripe, jamais côté serveur (PCI-DSS).
 */

let client: Stripe | null = null;

function getClient(): Stripe {
  if (!env.STRIPE_SECRET_KEY) {
    throw new AppError('SERVICE_UNAVAILABLE', 'Stripe is not configured (STRIPE_SECRET_KEY missing)');
  }
  if (!client) {
    client = new Stripe(env.STRIPE_SECRET_KEY);
  }
  return client;
}

export interface CreateStripeSessionInput {
  reference: string;
  itemName: string;
  /** Montant en EUR (unité majeure, ex: 6.99) — converti ici en centimes. */
  amountEur: number;
  successUrl: string;
  cancelUrl: string;
  metadata?: Record<string, string>;
}

export interface StripeSessionData {
  id: string;
  payment_url: string;
}

/** Crée une Checkout Session Stripe (mode paiement unique — pas d'abonnement récurrent Stripe). */
export async function createStripeCheckoutSession(
  input: CreateStripeSessionInput,
): Promise<StripeSessionData> {
  const stripe = getClient();

  let session: Stripe.Checkout.Session;
  try {
    session = await stripe.checkout.sessions.create({
      mode: 'payment',
      payment_method_types: ['card'],
      // reference = Transaction.reference, source de vérité unique pour
      // retrouver la Transaction depuis le webhook (voir applyPaidTransaction).
      client_reference_id: input.reference,
      line_items: [
        {
          price_data: {
            currency: 'eur',
            product_data: { name: input.itemName },
            unit_amount: Math.round(input.amountEur * 100),
          },
          quantity: 1,
        },
      ],
      success_url: input.successUrl,
      cancel_url: input.cancelUrl,
      metadata: { reference: input.reference, ...input.metadata },
    });
  } catch (e) {
    console.error('[stripe] checkout session creation failed:', e);
    throw new AppError('PAYMENT_FAILED', 'Stripe refused the checkout session');
  }

  if (!session.url) {
    throw new AppError('SERVICE_UNAVAILABLE', 'Stripe returned no checkout URL');
  }
  return { id: session.id, payment_url: session.url };
}

/**
 * Vérifie la signature du webhook Stripe et parse l'événement. Doit recevoir
 * le corps BRUT (Buffer/string), jamais le JSON reparsé — même contrainte
 * que DexPay (voir dexpay.webhook.ts).
 */
export function constructStripeEvent(rawBody: string | Buffer, signature: string): Stripe.Event {
  if (!env.STRIPE_WEBHOOK_SECRET) {
    throw new AppError('SERVICE_UNAVAILABLE', 'Stripe webhook is not configured (STRIPE_WEBHOOK_SECRET missing)');
  }
  const stripe = getClient();
  return stripe.webhooks.constructEvent(rawBody, signature, env.STRIPE_WEBHOOK_SECRET);
}

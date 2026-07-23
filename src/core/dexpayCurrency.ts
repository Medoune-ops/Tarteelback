import { env } from '../config/env.js';

/**
 * Convertit un prix interne en EUR (BILLING_CURRENCY) vers la devise DexPay
 * (XOF/XAF), en unité MINEURE ENTIÈRE — DexPay n'accepte pas de décimales
 * (contrairement aux centimes Stripe). Arrondi au franc le plus proche.
 */
export function eurToDexpayAmount(amountEur: number): number {
  return Math.round(amountEur * env.DEXPAY_EUR_XOF_RATE);
}

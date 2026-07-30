/**
 * Parrainage — code de partage de l'utilisateur + saisie du code d'un parrain.
 *
 *  - GET  /me/referral         → mon code de parrainage + nb de filleuls
 *  - POST /me/referral/redeem  → saisir le code d'un parrain (cœurs bonus pour les deux)
 */
import { apiFetch } from './client';

export interface ReferralInfo {
  code: string;
  referredCount: number;
  rewardPerReferral: number;
}

/** GET /me/referral — mon code de parrainage + nombre de filleuls. */
export async function fetchReferral(): Promise<ReferralInfo> {
  return apiFetch<ReferralInfo>('/me/referral');
}

/** POST /me/referral/redeem — saisit le code d'un parrain (cœurs bonus pour les deux). */
export async function redeemReferral(code: string): Promise<ReferralInfo> {
  return apiFetch<ReferralInfo>('/me/referral/redeem', {
    method: 'POST',
    json: { code },
  });
}

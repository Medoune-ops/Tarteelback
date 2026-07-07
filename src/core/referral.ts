import crypto from 'node:crypto';

/**
 * Parrainage — barème + génération de code, server-authoritative.
 *
 * Modèle : chaque utilisateur possède un `referralCode` unique qu'il partage.
 * Quand un NOUVEAU compte (jamais parrainé) saisit ce code, le parrain ET le
 * filleul reçoivent chacun `REFERRAL_HEART_REWARD` cœurs bonus. Un compte ne
 * peut être parrainé qu'une seule fois (garde-fou anti-abus côté serveur).
 */

/** Cœurs bonus crédités au parrain ET au filleul lors d'un parrainage validé. */
export const REFERRAL_HEART_REWARD = 2;

/**
 * Nombre maximum de filleuls dont le parrainage rapporte encore une récompense
 * au parrain. Au-delà, `redeem` reste valide pour le NOUVEAU compte (qui
 * touche toujours ses cœurs de bienvenue), mais le parrain n'en reçoit plus —
 * ferme le farming par création de faux comptes en masse.
 */
export const REFERRAL_MAX_REWARDED_REFERRALS = 20;

// Alphabet sans caractères ambigus (0/O, 1/I/L) pour un code facile à recopier.
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 6;

/** Génère un code de parrainage aléatoire (6 caractères non ambigus). */
export function generateReferralCode(): string {
  const bytes = crypto.randomBytes(CODE_LENGTH);
  let code = '';
  for (let i = 0; i < CODE_LENGTH; i++) {
    code += CODE_ALPHABET.charAt(bytes[i]! % CODE_ALPHABET.length);
  }
  return code;
}

/** Normalise un code saisi par l'utilisateur (majuscules, sans espaces). */
export function normalizeReferralCode(raw: string): string {
  return raw.trim().toUpperCase().replace(/\s+/g, '');
}

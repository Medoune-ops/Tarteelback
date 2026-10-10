import crypto from 'node:crypto';

/**
 * Amis — constantes, limites et génération de code, server-authoritative.
 *
 * Feature flag FRIENDS_ENABLED (voir config/env.ts) : tant qu'il est faux,
 * toutes les routes du module src/modules/friends renvoient 404 et aucune de
 * ces fonctions n'est appelée par les routes.
 */

/** Nombre maximum d'amis pour un compte gratuit. */
export const FRIEND_LIMIT_FREE = 9;

/** Nombre maximum d'amis pour un compte premium (effectif perso ou familial). */
export const FRIEND_LIMIT_PREMIUM = 20;

/**
 * Quota d'envois « à un ami » par jour calendaire UTC, TOUS TYPES CONFONDUS
 * (hadith, réussite, encouragement, relance de défi). Voir friends.quota.ts.
 */
export const FRIEND_DAILY_SEND_LIMIT = 3;

/** Longueur du code de partage ami. */
export const FRIEND_CODE_LENGTH = 6;

// Alphabet sans caractères ambigus (0/O, 1/I) pour un code facile à recopier.
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

/** Génère un code de partage ami aléatoire (6 caractères non ambigus). */
export function generateFriendCode(): string {
  const bytes = crypto.randomBytes(FRIEND_CODE_LENGTH);
  let code = '';
  for (let i = 0; i < FRIEND_CODE_LENGTH; i++) {
    code += CODE_ALPHABET.charAt(bytes[i]! % CODE_ALPHABET.length);
  }
  return code;
}

/** Normalise un code saisi/scanné (majuscules, sans espaces). */
export function normalizeFriendCode(raw: string): string {
  return raw.trim().toUpperCase().replace(/\s+/g, '');
}

/** Limite d'amis applicable selon le statut premium EFFECTIF. */
export function maxFriends(isPremium: boolean): number {
  return isPremium ? FRIEND_LIMIT_PREMIUM : FRIEND_LIMIT_FREE;
}

/**
 * Début du jour calendaire UTC (minuit UTC) de `date`. Sert d'unité de compte
 * au quota quotidien (décision produit : jour calendaire UTC — à Dakar, c'est
 * aussi minuit heure locale).
 */
export function utcDayStart(date: Date = new Date()): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

/**
 * Paire d'utilisateurs canonique : `user1Id` < `user2Id` (ordre lexicographique).
 * Une amitié A→B et B→A ne doit occuper qu'UNE seule ligne (contrainte unique).
 */
export function canonicalPair(a: string, b: string): { user1Id: string; user2Id: string } {
  return a < b ? { user1Id: a, user2Id: b } : { user1Id: b, user2Id: a };
}

/** L'autre membre d'une paire canonique. */
export function otherInPair(user1Id: string, user2Id: string, meId: string): string {
  return user1Id === meId ? user2Id : user1Id;
}

import { describe, it, expect } from 'vitest';

import { AppError } from '../src/core/errors.js';

/**
 * Ticket 0.B2 — vérifie la correspondance code d'erreur → statut HTTP pour les
 * codes propres aux amis / défis / quotas (contrat API).
 */
describe('AppError — codes amis/défis/quotas (ticket 0.B2)', () => {
  const cases: Array<[string, number]> = [
    ['NOT_FRIENDS', 403],
    ['BLOCKED', 403],
    ['FRIEND_LIMIT', 409],
    ['ALREADY_FRIENDS', 409],
    ['FRIEND_REQUEST_PENDING', 409],
    ['INVITE_INVALID', 400],
    ['INVITE_EXPIRED', 410],
    ['CANNOT_ADD_SELF', 400],
    ['FRIENDS_DISABLED', 503],
    ['CHALLENGE_CLOSED', 409],
    ['CHALLENGE_FULL', 409],
    ['QUOTA_EXCEEDED', 429],
  ];

  for (const [code, status] of cases) {
    it(`${code} → HTTP ${status}`, () => {
      const err = new AppError(code as any);
      expect(err.code).toBe(code);
      expect(err.statusCode).toBe(status);
      expect(err.name).toBe('AppError');
    });
  }
});

import { describe, it, expect } from 'vitest';
import {
  FRIEND_LIMIT_FREE,
  FRIEND_LIMIT_PREMIUM,
  FRIEND_CODE_LENGTH,
  generateFriendCode,
  normalizeFriendCode,
  maxFriends,
  utcDayStart,
  canonicalPair,
  otherInPair,
} from '../src/core/friends.js';

describe('friends — code de partage', () => {
  it('génère un code de 6 caractères, sans caractères ambigus', () => {
    for (let i = 0; i < 200; i++) {
      const code = generateFriendCode();
      expect(code).toHaveLength(FRIEND_CODE_LENGTH);
      expect(code).toMatch(/^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]+$/);
      expect(code).not.toMatch(/[0O1IL]/);
    }
  });

  it('génère des codes variés (pas un code constant)', () => {
    const codes = new Set(Array.from({ length: 50 }, () => generateFriendCode()));
    expect(codes.size).toBeGreaterThan(40);
  });

  it('normalise la saisie (majuscules, sans espaces)', () => {
    expect(normalizeFriendCode('  ab cd2 ')).toBe('ABCD2');
    expect(normalizeFriendCode('aBcD23')).toBe('ABCD23');
  });
});

describe('friends — limites', () => {
  it('applique 9 amis en gratuit et 20 en premium', () => {
    expect(maxFriends(false)).toBe(FRIEND_LIMIT_FREE);
    expect(maxFriends(true)).toBe(FRIEND_LIMIT_PREMIUM);
    expect(FRIEND_LIMIT_FREE).toBe(9);
    expect(FRIEND_LIMIT_PREMIUM).toBe(20);
  });
});

describe('friends — jour calendaire UTC', () => {
  it('renvoie minuit UTC du jour courant', () => {
    const d = new Date('2026-10-09T23:45:12.000Z');
    const start = utcDayStart(d);
    expect(start.toISOString()).toBe('2026-10-09T00:00:00.000Z');
  });

  it('est stable quel que soit l’instant dans la journée UTC', () => {
    const a = utcDayStart(new Date('2026-10-09T00:00:00.000Z'));
    const b = utcDayStart(new Date('2026-10-09T23:59:59.999Z'));
    expect(a.getTime()).toBe(b.getTime());
  });
});

describe('friends — paire canonique', () => {
  it('ordonne user1Id < user2Id', () => {
    expect(canonicalPair('b', 'a')).toEqual({ user1Id: 'a', user2Id: 'b' });
    expect(canonicalPair('a', 'b')).toEqual({ user1Id: 'a', user2Id: 'b' });
  });

  it('est stable quel que soit l’ordre des arguments', () => {
    expect(canonicalPair('x', 'y')).toEqual(canonicalPair('y', 'x'));
  });

  it("retourne l'autre membre de la paire", () => {
    expect(otherInPair('a', 'b', 'a')).toBe('b');
    expect(otherInPair('a', 'b', 'b')).toBe('a');
  });
});

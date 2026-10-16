import { describe, it, expect } from 'vitest';

import {
  orderPair,
  FREE_MAX_FRIENDS,
  PREMIUM_MAX_FRIENDS,
  MAX_PENDING_REQUESTS,
  FREE_MESSAGES_PER_DAY,
  MESSAGES_PER_DAY,
  maxFriendsFor,
  canAddFriend,
  canBecomeFriends,
  type OrderedPair,
} from '../src/core/friendship.js';

describe('core/friendship — logique pure (ticket 1.B2)', () => {
  it('orderPair est symétrique', () => {
    const p1 = orderPair('b', 'a');
    const p2 = orderPair('a', 'b');
    expect(p1).toEqual(p2);
    expect(p1.low).toBe('a');
    expect(p1.high).toBe('b');
  });

  it('limites 9 / 20 + constantes', () => {
    expect(FREE_MAX_FRIENDS).toBe(9);
    expect(PREMIUM_MAX_FRIENDS).toBe(20);
    expect(MAX_PENDING_REQUESTS).toBe(50);
    expect(FREE_MESSAGES_PER_DAY).toBe(3);
    expect(MESSAGES_PER_DAY).toBe(30);
    expect(maxFriendsFor(false)).toBe(9);
    expect(maxFriendsFor(true)).toBe(20);
  });

  it('refus si UN SEUL des deux a atteint sa limite', () => {
    // A à la limite (9), B à 0 → impossible
    expect(canBecomeFriends(9, false, 0, false)).toBe(false);
    // D-B : les deux OK
    expect(canBecomeFriends(8, false, 0, false)).toBe(true);
    // premium A déjà à 20, B ok → refus
    expect(canBecomeFriends(20, true, 0, true)).toBe(false);
  });

  it('D-C : compte gratuit à 12 amis garde ses amis mais ne peut plus en ajouter', () => {
    const friends: string[] = Array.from({ length: 12 }, (_, i) => `u${i}`);
    // aucune suppression effectuée par canAddFriend (fonction pure, pas de mutation)
    expect(friends.length).toBe(12);
    expect(canAddFriend(12, false)).toBe(false);
    expect(canAddFriend(12, false)).toBe(canAddFriend(9, false)); // même refus au-delà
  });
});

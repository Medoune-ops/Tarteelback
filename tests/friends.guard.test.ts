import { describe, it, expect, vi, afterEach } from 'vitest';

/**
 * Règle 8 : FRIENDS_ENABLED coupe tout. Désactivé → les routes amis doivent se
 * comporter comme inexistantes (NOT_FOUND), jamais fuiter. Activé → passent.
 */
describe('friends guard (règle 8)', () => {
  afterEach(() => {
    vi.resetModules();
    vi.unmock('../src/config/env.js');
  });

  it('désactivé → requireFriendsEnabled lance NOT_FOUND', async () => {
    vi.doMock('../src/config/env.js', () => ({ env: { FRIENDS_ENABLED: false } }));
    const g = await import('../src/modules/friends/friends.guard.js');
    expect(g.isFriendsEnabled()).toBe(false);
    expect(() => g.requireFriendsEnabled()).toThrow();
  });

  it('activé → requireFriendsEnabled ne lance pas', async () => {
    vi.doMock('../src/config/env.js', () => ({ env: { FRIENDS_ENABLED: true } }));
    const g = await import('../src/modules/friends/friends.guard.js');
    expect(g.isFriendsEnabled()).toBe(true);
    expect(() => g.requireFriendsEnabled()).not.toThrow();
  });
});

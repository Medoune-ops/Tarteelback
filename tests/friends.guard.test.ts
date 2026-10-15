import { describe, it, expect, vi, afterEach } from 'vitest';

describe('friends guard (ticket 0.B4)', () => {
  afterEach(() => {
    vi.resetModules();
    vi.unmock('../src/config/env.js');
  });

  it('désactivé → requireFriendsEnabled lance FRIENDS_DISABLED (503)', async () => {
    vi.doMock('../src/config/env.js', async (importOriginal) => {
      const actual = await importOriginal<typeof import('../src/config/env.js')>();
      return {
        ...actual,
        env: { ...actual.env, FRIENDS_ENABLED: false, FRIENDS_BETA_USER_IDS: [] },
      };
    });
    const g = await import('../src/modules/friends/friends.guard.js');
    expect(g.isFriendsEnabled()).toBe(false);
    expect(() => g.requireFriendsEnabled()).toThrow();
    try {
      g.requireFriendsEnabled();
    } catch (e) {
      expect((e as { code?: string }).code).toBe('FRIENDS_DISABLED');
      expect((e as { statusCode?: number }).statusCode).toBe(503);
    }
  });

  it('activé → requireFriendsEnabled ne lance pas', async () => {
    vi.doMock('../src/config/env.js', async (importOriginal) => {
      const actual = await importOriginal<typeof import('../src/config/env.js')>();
      return {
        ...actual,
        env: { ...actual.env, FRIENDS_ENABLED: true, FRIENDS_BETA_USER_IDS: [] },
      };
    });
    const g = await import('../src/modules/friends/friends.guard.js');
    expect(g.isFriendsEnabled()).toBe(true);
    expect(() => g.requireFriendsEnabled()).not.toThrow();
  });

  it('liste bêta → refus pour un utilisateur hors liste', async () => {
    vi.doMock('../src/config/env.js', async (importOriginal) => {
      const actual = await importOriginal<typeof import('../src/config/env.js')>();
      return {
        ...actual,
        env: { ...actual.env, FRIENDS_ENABLED: true, FRIENDS_BETA_USER_IDS: ['u1'] },
      };
    });
    const g = await import('../src/modules/friends/friends.guard.js');
    expect(g.isFriendsEnabled('u2')).toBe(false);
    expect(() => g.requireFriendsEnabled('u2')).toThrow();
  });
});

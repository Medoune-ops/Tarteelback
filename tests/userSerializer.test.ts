import { describe, it, expect } from 'vitest';
import type { User } from '@prisma/client';
import { serializeUserFlat } from '../src/modules/me/user.serializer.js';
import type { UserStats } from '../src/modules/me/user.stats.js';

/**
 * Contrat de la forme PLATE (GET /me, POST /lesson/complete, /me/referral).
 *
 * Régression visée : `streakGoal` n'était renvoyé que par `serializeUser` (les
 * réponses d'auth), pas par `serializeUserFlat`. Le store RN n'écrit un champ
 * que s'il est `!== undefined` — une clé absente le laissait donc à `null`, et
 * l'objectif de série fixé par l'utilisateur restait invisible dans l'app alors
 * que PUT /me/streak-goal l'avait bien enregistré en base.
 *
 * Unitaire à dessein : pas de base, donc ce test tourne toujours (les tests
 * d'intégration sont sautés sans RUN_DB_TESTS).
 */

const now = new Date('2026-01-15T12:00:00Z');

/** User minimal — seuls les champs lus par le serializer comptent vraiment. */
function makeUser(overrides: Partial<User> = {}): User {
  return {
    id: 'u1',
    email: 'a@b.c',
    displayName: 'Test',
    username: null,
    streak: 3,
    weeklyXp: 120,
    hearts: 5,
    lastHeartLossAt: null,
    gems: 40,
    streakFreezes: 0,
    doubleXpUntil: null,
    premiumUntil: null,
    currentLesson: 1,
    onboardingDone: true,
    level: 'debutant',
    objectif: 'lire',
    dailyMinutes: 10,
    timezone: 'UTC',
    language: 'fr',
    voiceEnabled: true,
    emailVerified: true,
    streakGoal: null,
    lastChestDay: null,
    reviewHeartsDay: null,
    reviewHeartsUsed: 0,
    ...overrides,
  } as unknown as User;
}

const stats: UserStats = { currentLesson: 1, sourates: 0, precision: 0 };

describe('serializeUserFlat — contrat du store RN', () => {
  it('renvoie streakGoal quand un objectif est fixé', () => {
    const out = serializeUserFlat(makeUser({ streakGoal: 30 }), stats, now);
    expect(out.streakGoal).toBe(30);
  });

  it('renvoie streakGoal: null (présent, pas absent) quand aucun objectif', () => {
    const out = serializeUserFlat(makeUser({ streakGoal: null }), stats, now);
    // `null` et `undefined` se ressemblent en JS mais PAS pour le store : il
    // teste `!== undefined`, donc la clé doit exister même vide.
    expect('streakGoal' in out).toBe(true);
    expect(out.streakGoal).toBeNull();
  });

  it('survit au JSON : la clé ne disparaît pas à la sérialisation', () => {
    const out = JSON.parse(JSON.stringify(serializeUserFlat(makeUser({ streakGoal: 7 }), stats, now)));
    expect(out.streakGoal).toBe(7);
  });

  it('garde hearts en nombre (le store ne sait pas lire un objet)', () => {
    const out = serializeUserFlat(makeUser(), stats, now);
    expect(typeof out.hearts).toBe('number');
  });

  it('n’enveloppe rien dans `user` — la forme reste plate', () => {
    const out = serializeUserFlat(makeUser(), stats, now) as Record<string, unknown>;
    expect(out.user).toBeUndefined();
  });
});

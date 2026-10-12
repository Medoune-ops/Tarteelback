import { describe, it, expect, vi, beforeEach } from 'vitest';

const findFirst = vi.fn();
vi.mock('../src/config/prisma.js', () => ({
  prisma: { friendActivity: { findFirst: (...a: unknown[]) => findFirst(...a) } },
}));

const getLearnedSourates = vi.fn();
vi.mock('../src/modules/me/learnedSourates.js', () => ({
  getLearnedSourates: (...a: unknown[]) => getLearnedSourates(...a),
}));

import { friendsActivityService } from '../src/modules/friends/friends.activity.js';

/**
 * Règle 3 : publier côté amis/défis ne doit JAMAIS faire échouer l'appelant
 * (ex. terminer une leçon). Ces méthodes doivent avaler toute erreur.
 */
describe('friends activity — best-effort (règle 3)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('recordSourateIfMastered ne propage jamais une erreur (renvoie null)', async () => {
    getLearnedSourates.mockRejectedValueOnce(new Error('boom'));
    await expect(friendsActivityService.recordSourateIfMastered('u1', 1)).resolves.toBeNull();
  });

  it('recordStreakMilestone avale une erreur DB', async () => {
    findFirst.mockRejectedValueOnce(new Error('db down'));
    await expect(friendsActivityService.recordStreakMilestone('u1', 7)).resolves.toBeUndefined();
  });

  it('recordStreakMilestone ignore un palier non listé sans toucher la DB', async () => {
    await expect(friendsActivityService.recordStreakMilestone('u1', 4)).resolves.toBeUndefined();
    expect(findFirst).not.toHaveBeenCalled();
  });
});

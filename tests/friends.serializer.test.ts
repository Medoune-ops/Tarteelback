import { describe, it, expect } from 'vitest';

import { serializePublicProfile } from '../src/modules/friends/friends.serializer.js';

describe('friends - sérialiseur PublicProfile à liste blanche (ticket 0.B4)', () => {
  it('ne recopie QUE les 8 clés attendues', () => {
    const row = {
      id: 'u1',
      displayName: 'Aicha',
      username: 'aicha',
      avatarInitials: 'A',
      streak: 12,
      learnedSouratesCount: 3,
      leagueTier: 'Bronze',
      weeklyXp: 340,
      // sensibles :
      email: 'aicha@example.com',
      timezone: 'Europe/Paris',
      gems: 500,
      hearts: 5,
      isPremium: true,
      passwordHash: 'x',
    } as unknown as Parameters<typeof serializePublicProfile>[0];

    const view = serializePublicProfile(row);
    const expected = ['id', 'displayName', 'username', 'avatarInitials', 'streak', 'learnedSouratesCount', 'leagueTier', 'weeklyXp'];
    expect(Object.keys(view).sort()).toEqual([...expected].sort());
    expect(view).toEqual({
      id: 'u1',
      displayName: 'Aicha',
      username: 'aicha',
      avatarInitials: 'A',
      streak: 12,
      learnedSouratesCount: 3,
      leagueTier: 'Bronze',
      weeklyXp: 340,
    });
  });
});

import { describe, it, expect } from 'vitest';

import { serializePublicProfile } from '../src/modules/friends/friends.serializer.js';

describe('friends - sérialiseur PublicProfile à liste blanche (ticket 0.B4)', () => {
  it('ne recopie QUE les 9 clés attendues', () => {
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
    const expected = ['id', 'displayName', 'username', 'avatarInitials', 'avatarStyle', 'streak', 'learnedSouratesCount', 'leagueTier', 'weeklyXp'];
    expect(Object.keys(view).sort()).toEqual([...expected].sort());
    expect(view).toEqual({
      id: 'u1',
      displayName: 'Aicha',
      username: 'aicha',
      avatarInitials: 'A',
      avatarStyle: null,
      streak: 12,
      learnedSouratesCount: 3,
      leagueTier: 'Bronze',
      weeklyXp: 340,
    });
  });

  it('renvoie un avatar valide et ignore un avatar invalide', () => {
    const avatarStyle = {
      face: 'rond', skin: '#c98b5e', hair: 'kufi', hairColor: '#f4f3fa', eyes: 'joyeux',
      mouth: 'sourire', acc: 'joues', outfit: 'qamis', outfitColor: '#17a8bd', bg: '#b8e6f2',
    };
    expect(serializePublicProfile({ id: 'u1', displayName: 'A', avatarStyle }).avatarStyle).toEqual(avatarStyle);
    // Choix inconnu ou champ en trop : on retombe sur l'avatar par défaut.
    expect(serializePublicProfile({ id: 'u1', displayName: 'A', avatarStyle: { ...avatarStyle, hair: 'crete' } }).avatarStyle).toBeNull();
    expect(serializePublicProfile({ id: 'u1', displayName: 'A', avatarStyle: { ...avatarStyle, extra: '<script>' } }).avatarStyle).toBeNull();
  });
});

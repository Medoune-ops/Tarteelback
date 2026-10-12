import { describe, it, expect } from 'vitest';
import {
  serializePublicUser,
  serializeFriend,
  serializeFriendProgress,
} from '../src/modules/friends/friends.serializer.js';

const ALLOWED = ['id', 'displayName', 'username', 'avatarInitials'];

describe('friends — sérialiseur public à liste blanche (règle 6)', () => {
  it('ne recopie QUE la liste blanche, même si l’objet en contient plus', () => {
    const row = {
      id: 'u1',
      displayName: 'Aicha',
      username: 'aicha',
      avatarInitials: 'A',
      // champs sensibles qui ne doivent JAMAIS sortir :
      email: 'aicha@example.com',
      timezone: 'Europe/Paris',
      gems: 500,
      hearts: 5,
      isPremium: true,
      subscription: { plan: 'premium' },
      passwordHash: 'x',
    } as unknown as Parameters<typeof serializePublicUser>[0];

    const view = serializePublicUser(row);
    expect(Object.keys(view).sort()).toEqual([...ALLOWED].sort());
    expect(view).toEqual({
      id: 'u1',
      displayName: 'Aicha',
      username: 'aicha',
      avatarInitials: 'A',
    });
    expect(view as unknown as Record<string, unknown>).not.toHaveProperty('email');
    expect(view as unknown as Record<string, unknown>).not.toHaveProperty('timezone');
    expect(view as unknown as Record<string, unknown>).not.toHaveProperty('gems');
    expect(view as unknown as Record<string, unknown>).not.toHaveProperty('isPremium');
  });

  it('serializeFriend expose l’autre membre sous liste blanche', () => {
    const base = { id: 'x', displayName: 'X', username: null, avatarInitials: 'X' };
    const friendship = {
      id: 'f1',
      user1Id: 'me',
      user2Id: 'other',
      createdAt: new Date('2026-01-02T03:04:05.000Z'),
      user1: { ...base, id: 'me', email: 'me@example.com', gems: 1 },
      user2: { ...base, id: 'other', email: 'other@example.com', hearts: 9 },
    } as unknown as Parameters<typeof serializeFriend>[0];

    const view = serializeFriend(friendship, 'me');
    expect(view.friendshipId).toBe('f1');
    expect(view.since).toBe('2026-01-02T03:04:05.000Z');
    expect(Object.keys(view.user).sort()).toEqual([...ALLOWED].sort());
    expect(view.user).not.toHaveProperty('email');
    expect(view.user).not.toHaveProperty('hearts');
  });

  it('serializeFriendProgress filtre l’utilisateur et agrège les sourates', () => {
    const user = {
      id: 'u2',
      displayName: 'Youssef',
      username: 'yusuf',
      avatarInitials: 'Y',
      streak: 12,
      weeklyXp: 340,
      email: 'leak@example.com',
      isPremium: true,
    } as unknown as Parameters<typeof serializeFriendProgress>[0];

    const view = serializeFriendProgress(user, [
      { numero: 1, nom: 'Al-Fatiha', verses: 7 } as never,
      { numero: 112, nom: 'Al-Ikhlas', verses: 4 } as never,
    ]);

    expect(Object.keys(view.user).sort()).toEqual([...ALLOWED].sort());
    expect(view.user).not.toHaveProperty('email');
    expect(view.streak).toBe(12);
    expect(view.weeklyXp).toBe(340);
    expect(view.masteredSourates).toBe(2);
    expect(view.masteredSourateNumeros).toEqual([1, 112]);
  });
});

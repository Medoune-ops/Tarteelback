import { prisma } from '../../src/config/prisma.js';
import { now, setClock, useInjectedClock, resetClock, type Clock } from '../../src/core/clock.js';

export { now, setClock, useInjectedClock, resetClock, type Clock };

export interface MadeUser {
  id: string;
  email: string;
  displayName: string;
  username: string | null;
  avatarInitials: string;
}

/**
 * Crée `n` utilisateurs minimalistes en base (aucune auth requise) pour les
 * tests d'intégration.
 */
export async function makeUsers(
  n: number,
  overrides: Partial<{ email: string; displayName: string; username: string; avatarInitials: string }> = {},
): Promise<MadeUser[]> {
  const users: MadeUser[] = [];
  for (let i = 0; i < n; i++) {
    const email = overrides.email ?? `testuser${i}_${Date.now()}@test.app`;
    const displayName = overrides.displayName ?? `Test User ${i}`;
    const username = overrides.username ?? `testuser${i}_${Date.now()}`;
    const avatarInitials = overrides.avatarInitials ?? 'TU';
    const user = await prisma.user.create({
      data: {
        email,
        displayName,
        username,
        avatarInitials,
        passwordHash: 'test-hash',
        role: 'user',
        emailVerified: true,
      },
    });
    users.push({
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      username: user.username,
      avatarInitials: user.avatarInitials,
    });
  }
  return users;
}

/**
 * Établit une relation d'amitié entre deux utilisateurs.
 * Si le modèle Friendship n'est pas encore présent (tickets antérieurs), on
 * retourne un objet synthétique pour garder les tests futurs compatibles.
 */
export async function makeFriends(a: string | { id: string }, b: string | { id: string }): Promise<unknown> {
  const aId = typeof a === 'string' ? a : a.id;
  const bId = typeof b === 'string' ? b : b.id;
  const model = (prisma as unknown as { friendship?: { create: (args: unknown) => Promise<unknown> } }).friendship;
  if (model && typeof model.create === 'function') {
    return model.create({
      data: { user1Id: aId, user2Id: bId, createdAt: now() },
    });
  }
  return {
    id: `friendship-${aId}-${bId}`,
    user1Id: aId,
    user2Id: bId,
    createdAt: now(),
  };
}

/**
 * Marque toutes les leçons taguées `sourateNumero === numero` comme complétées
 * pour l'utilisateur donné.
 */
export async function completeSourate(user: string | { id: string }, numero: number): Promise<number> {
  const userId = typeof user === 'string' ? user : user.id;
  const lessons = await prisma.lesson.findMany({
    where: { sourateNumero: numero },
    select: { id: true },
  });
  await Promise.all(
    lessons.map((lesson) =>
      prisma.lessonProgress.upsert({
        where: { userId_lessonId: { userId, lessonId: lesson.id } },
        create: { userId, lessonId: lesson.id, etat: 'completed', completedAt: now() },
        update: { etat: 'completed', completedAt: now() },
      }),
    ),
  );
  return lessons.length;
}

export const testClock = {
  now: () => now(),
  set: (date: Date) => setClock(() => date),
  reset: () => resetClock(),
};

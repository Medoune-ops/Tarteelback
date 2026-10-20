import { prisma } from '../config/prisma.js';

/**
 * Vérifie quelles sourates parmi `numeros` sont entièrement maîtrisées par
 * l'utilisateur : toutes les leçons taguées `sourateNumero === numero` sont
 * complétées (etat = 'completed').
 *
 * Version ciblée : 1 requête pour les leçons + 1 requête par sourate distincte.
 * Les leçons de l'alphabet (sourateNumero = null) n'entrent jamais en compte.
 * Les sourates sans leçon dédiée ne sont pas considérées ici.
 */
export async function masteredAmong(userId: string, numeros: number[]): Promise<number[]> {
  if (numeros.length === 0) return [];

  const lessons = await prisma.lesson.findMany({
    where: {
      sourateNumero: { in: numeros },
    },
    select: { id: true, sourateNumero: true },
  });

  // Grouper les IDs de leçon par numéro de sourate.
  const lessonsBySourate = new Map<number, string[]>();
  for (const l of lessons) {
    const num = l.sourateNumero!;
    const arr = lessonsBySourate.get(num) ?? [];
    arr.push(l.id);
    lessonsBySourate.set(num, arr);
  }

  const mastered: number[] = [];
  for (const [numero, lessonIds] of lessonsBySourate) {
    const done = await prisma.lessonProgress.count({
      where: {
        userId,
        lessonId: { in: lessonIds },
        etat: 'completed',
      },
    });
    if (done === lessonIds.length) {
      mastered.push(numero);
    }
  }

  return mastered.sort((a, b) => a - b);
}

/**
 * Détermine si une leçon complétée est la dernière leçon d'une sourate, et si
 * cette sourate est désormais entièrement maîtrisée. Retourne le numéro de
 * sourate maîtrisée, ou null si aucune nouvelle maîtrise.
 *
 * Idempotent : si la réussite existe déjà, retourne null.
 */
export async function detectNewlyMasteredSourate({
  userId,
  lessonId,
}: {
  userId: string;
  lessonId: string;
}): Promise<number | null> {
  const lesson = await prisma.lesson.findUnique({
    where: { id: lessonId },
    select: { id: true, sourateNumero: true },
  });
  if (!lesson?.sourateNumero) return null; // leçon de l'alphabet ou sans sourate

  const sourateNumero = lesson.sourateNumero;

  // Vérifier que TOUTES les leçons de cette sourate sont complétées.
  const allLessons = await prisma.lesson.findMany({
    where: { sourateNumero },
    select: { id: true },
  });
  const lessonIds = allLessons.map((l) => l.id);
  if (lessonIds.length === 0) return null;

  const completedCount = await prisma.lessonProgress.count({
    where: {
      userId,
      lessonId: { in: lessonIds },
      etat: 'completed',
    },
  });
  if (completedCount !== lessonIds.length) return null;

  // Vérifier que la réussite n'existe pas déjà (idempotent).
  const existing = await prisma.achievement.findUnique({
    where: {
      userId_type_refKey: { userId, type: 'sourate_mastered', refKey: String(sourateNumero) },
    },
  });
  if (existing) return null;

  return sourateNumero;
}

/**
 * Crée une Achievement pour une sourate nouvellement maîtrisée. Idempotent.
 * Retourne l'ID de la réussite créée, ou null si elle existait déjà.
 */
export async function recordMastery({
  userId,
  sourateNumero,
}: {
  userId: string;
  sourateNumero: number;
}): Promise<string | null> {
  const existing = await prisma.achievement.findUnique({
    where: {
      userId_type_refKey: { userId, type: 'sourate_mastered', refKey: String(sourateNumero) },
    },
    select: { id: true },
  });
  if (existing) return existing.id;

  const sourate = await prisma.sourate.findUnique({
    where: { numero: sourateNumero },
    select: { id: true, nom: true, nombreVersets: true },
  });
  if (!sourate) return null;

  const achievement = await prisma.achievement.create({
    data: {
      userId,
      type: 'sourate_mastered',
      refKey: String(sourateNumero),
      payload: {
        sourateId: sourate.id,
        sourateNumero,
        nom: sourate.nom,
        nombreVersets: sourate.nombreVersets,
      },
    },
  });
  return achievement.id;
}

import { prisma } from '../../config/prisma.js';
import type { I18nText } from '../content/content.serializer.js';

/**
 * A lettre/harakat lesson the user has completed, ready to be revised.
 * `titre` is the RAW i18n value (string or `{fr,en,...}`) — resolved to the
 * caller's language by `resolveI18n` at the point where it's serialized.
 */
export interface LearnedLettreLesson {
  id: string;
  titre: I18nText;
  ordre: number;
}

/**
 * Alphabet/harakat lessons the user has completed — i.e. `Lesson.sourateNumero
 * IS NULL` (letters + fatha/kasra/damma/sukun/tanwin/récap, as opposed to
 * verse-teaching lessons) with `LessonProgress.etat = completed`.
 *
 * Derived live from LessonProgress, mirroring `getLearnedSourates`. Sorted by
 * `ordre` (teaching order: letters, then harakat).
 */
export async function getLearnedLettreLessons(userId: string): Promise<LearnedLettreLesson[]> {
  const completed = await prisma.lessonProgress.findMany({
    where: { userId, etat: 'completed', lesson: { sourateNumero: null } },
    select: { lesson: { select: { id: true, titre: true, ordre: true } } },
  });

  return completed
    .map((c) => c.lesson)
    .sort((a, b) => a.ordre - b.ordre);
}

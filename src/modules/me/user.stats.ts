import { prisma } from '../../config/prisma.js';
import { getLearnedSourates } from './learnedSourates.js';

/**
 * Derived progression stats the RN store needs but that aren't stored on the
 * User row — they're computed from LessonProgress.
 *
 * Mapping to the front's flat contract (BACKEND.md):
 *  - currentLesson: 1-based index of the next lesson to unlock = (#completed)+1.
 *  - sourates:      number of surahs learned in full (every lesson of a section
 *                   that teaches the surah is completed) — same definition as
 *                   the GET /me/sourates list, so badge count and list match.
 *  - precision:     global average lesson score (0–100), rounded; 0 if none yet.
 */
export interface UserStats {
  currentLesson: number;
  sourates: number;
  precision: number;
}

export async function computeUserStats(userId: string): Promise<UserStats> {
  const [completedCount, learned, scoreAgg] = await Promise.all([
    prisma.lessonProgress.count({ where: { userId, etat: 'completed' } }),
    getLearnedSourates(userId),
    prisma.lessonProgress.aggregate({
      where: { userId, etat: 'completed' },
      _avg: { score: true },
    }),
  ]);

  return {
    currentLesson: completedCount + 1,
    sourates: learned.length,
    precision: Math.round(scoreAgg._avg.score ?? 0),
  };
}

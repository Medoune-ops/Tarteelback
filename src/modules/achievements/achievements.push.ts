import { registerOutboxHandler } from '../../core/outbox.js';
import { prisma } from '../../config/prisma.js';
import {
  detectNewlyMasteredSourate,
  recordMastery,
} from '../../core/achievements.js';

/**
 * Quand une leçon est complétée (événement outbox `lesson.completed`), on
 * détecte si l'utilisateur vient de maîtriser entièrement une sourate (toutes
 * ses leçons complétées pour la première fois). Si oui, on enregistre une
 * Achievement de type 'sourate_mastered'.
 *
 * Idempotent : rejouer l'événement ne crée jamais de doublon, car
 * detectNewlyMasteredSourate vérifie l'existence de la réussite avant de
 * l'insérer.
 */
registerOutboxHandler('lesson.completed', async (event) => {
  const payload = (event.payload ?? {}) as {
    lessonId?: string;
    userId?: string;
    firstCompletion?: boolean;
    sourateNumero?: number | null;
  };

  if (!payload.firstCompletion || !payload.lessonId || !payload.userId) return;
  if (payload.sourateNumero === null || payload.sourateNumero === undefined) return;

  const newlyMastered = await detectNewlyMasteredSourate({
    userId: payload.userId,
    lessonId: payload.lessonId,
  });

  if (newlyMastered === null) return;

  await recordMastery({
    userId: payload.userId,
    sourateNumero: newlyMastered,
  });
});

export function registerAchievementPushHandlers(): void {
  // no-op: registration happens on import
}

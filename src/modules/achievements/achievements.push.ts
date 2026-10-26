import { registerOutboxHandler } from '../../core/outbox.js';
import { prisma } from '../../config/prisma.js';
import { detectNewlyMasteredSourate, recordMastery } from '../../core/achievements.js';

/** Paliers de streak qui donnent une réussite (jours d'affilée). */
export const STREAK_MILESTONES = [7, 30, 100, 365] as const;

/**
 * Réussites détectées à la fin d'une leçon (événement `lesson.completed`) :
 *  - sourate maîtrisée : la leçon était la dernière de sa sourate ;
 *  - section terminée : toutes les leçons de sa section sont faites ;
 *  - palier de streak : le streak vaut exactement un palier.
 *
 * L'utilisateur est `event.userId` (le payload ne le contient pas).
 * Idempotent : contrainte unique (userId, type, refKey) + upsert, rejouer
 * l'événement ne crée jamais de doublon. Refaire une leçon déjà faite
 * (firstCompletion = false) ne crée rien.
 */
registerOutboxHandler('lesson.completed', async (event) => {
  const userId = event.userId;
  const payload = (event.payload ?? {}) as { lessonId?: string; firstCompletion?: boolean };
  if (!payload.lessonId) return;

  if (payload.firstCompletion) {
    const newlyMastered = await detectNewlyMasteredSourate({ userId, lessonId: payload.lessonId });
    if (newlyMastered !== null) await recordMastery({ userId, sourateNumero: newlyMastered });

    await recordSectionIfCompleted(userId, payload.lessonId);
  }

  await recordStreakMilestone(userId);
});

async function recordSectionIfCompleted(userId: string, lessonId: string) {
  const lesson = await prisma.lesson.findUnique({
    where: { id: lessonId },
    select: {
      section: { select: { id: true, ordre: true, hizb: true, titre: true, lessons: { select: { id: true } } } },
    },
  });
  const section = lesson?.section;
  if (!section || section.lessons.length === 0) return;
  const done = await prisma.lessonProgress.count({
    where: { userId, etat: 'completed', lessonId: { in: section.lessons.map((l) => l.id) } },
  });
  if (done !== section.lessons.length) return;
  await prisma.achievement.upsert({
    where: { userId_type_refKey: { userId, type: 'section_completed', refKey: section.id } },
    create: {
      userId,
      type: 'section_completed',
      refKey: section.id,
      payload: { sectionId: section.id, ordre: section.ordre, hizb: section.hizb, titre: section.titre ?? null },
    },
    update: {},
  });
}

async function recordStreakMilestone(userId: string) {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { streak: true } });
  const days = user?.streak ?? 0;
  if (!(STREAK_MILESTONES as readonly number[]).includes(days)) return;
  await prisma.achievement.upsert({
    where: { userId_type_refKey: { userId, type: 'streak_milestone', refKey: `d${days}` } },
    create: { userId, type: 'streak_milestone', refKey: `d${days}`, payload: { days } },
    update: {},
  });
}

/**
 * Promotion de ligue (événement `league.promoted`, émis par le passage de
 * semaine des ligues). Une réussite par semaine clôturée.
 */
registerOutboxHandler('league.promoted', async (event) => {
  const payload = (event.payload ?? {}) as { weekId?: string; toLeagueId?: string; semaine?: number };
  if (!payload.weekId || !payload.toLeagueId) return;
  const league = await prisma.league.findUnique({
    where: { id: payload.toLeagueId },
    select: { nom: true, ordre: true },
  });
  if (!league) return;
  await prisma.achievement.upsert({
    where: { userId_type_refKey: { userId: event.userId, type: 'league_promoted', refKey: payload.weekId } },
    create: {
      userId: event.userId,
      type: 'league_promoted',
      refKey: payload.weekId,
      payload: { league: league.nom, ordre: league.ordre, semaine: payload.semaine ?? null },
    },
    update: {},
  });
});

export function registerAchievementPushHandlers(): void {
  // no-op: registration happens on import
}

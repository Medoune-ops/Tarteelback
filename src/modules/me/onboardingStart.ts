import type { Prisma, UserLevel } from '@prisma/client';
import { prisma } from '../../config/prisma.js';

/**
 * Personnalise le POINT DE DÉPART du parcours à la fin de l'onboarding.
 *
 * Le contenu (sections/leçons) est partagé par tous ; seule la PROGRESSION est
 * propre à l'utilisateur. On « saute » donc ce qu'il maîtrise déjà en créant des
 * LessonProgress `completed` — le nœud actif (1ʳᵉ leçon non-complétée) se décale
 * alors automatiquement au bon endroit, sans dupliquer de contenu.
 *
 * Deux sources de skip :
 *   - Sait déjà lire (level ≠ debutant) → toute la section Alphabet (hizb null),
 *     Al-Fatiha incluse.
 *   - Sourates déjà mémorisées → CETTE sourate ET TOUT ce qui la précède dans
 *     l'ordre RÉEL du parcours (Section.ordre puis Lesson.ordre — même tri que
 *     content.repository.ts#listTeachingOrder). Ex : cocher An-Nas (dernière
 *     sourate du Coran, mais apprise en PREMIER dans le parcours) doit aussi
 *     marquer acquis l'alphabet, les harakat et Al-Fatiha — sinon
 *     l'utilisateur se retrouve avec des leçons verrouillées avant une
 *     sourate qu'il vient de déclarer maîtriser, ce qui bloque bêtement sa
 *     progression au lieu de le faire démarrer à la sourate suivante (Al-Falaq).
 *
 * Idempotent (skipDuplicates). Aucun XP / streak crédité : ces leçons sont
 * marquées acquises, pas « jouées ».
 */
export async function applyOnboardingStart(
  userId: string,
  level: UserLevel,
  sourateNumeros: number[],
): Promise<number> {
  const or: Prisma.LessonWhereInput[] = [];

  // Sait lire → toute la section Alphabet est acquise (Fatiha comprise).
  if (level !== 'debutant') {
    or.push({ section: { hizb: null } });
  }

  // Sourates mémorisées → elles-mêmes ET tout ce qui les précède dans l'ordre
  // réel d'enseignement (pas seulement leurs propres leçons).
  const uniq = [...new Set(sourateNumeros)].filter((n) => Number.isInteger(n) && n >= 1 && n <= 114);
  if (uniq.length > 0) {
    // Dernière leçon (position la plus tardive) de chacune de ces sourates —
    // une sourate peut être enseignée sur plusieurs leçons.
    const lastLessons = await prisma.lesson.findMany({
      where: { sourateNumero: { in: uniq } },
      orderBy: [{ section: { ordre: 'desc' } }, { ordre: 'desc' }],
      distinct: ['sourateNumero'],
      select: { section: { select: { ordre: true } }, ordre: true },
    });
    // Le point de coupure = la position la plus AVANCÉE parmi ces sourates
    // (celle apprise le plus tard) : tout ce qui est enseigné jusque-là est acquis.
    for (const l of lastLessons) {
      or.push({
        OR: [
          { section: { ordre: { lt: l.section.ordre } } },
          { section: { ordre: l.section.ordre }, ordre: { lte: l.ordre } },
        ],
      });
    }
  }

  if (or.length === 0) return 0;

  const lessons = await prisma.lesson.findMany({ where: { OR: or }, select: { id: true } });
  if (lessons.length === 0) return 0;

  const now = new Date();
  const res = await prisma.lessonProgress.createMany({
    data: lessons.map((l) => ({
      userId,
      lessonId: l.id,
      etat: 'completed' as const,
      score: 0,
      completedAt: now,
    })),
    skipDuplicates: true,
  });
  return res.count;
}

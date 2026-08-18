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
 *   - Sourates déjà mémorisées → TOUT le parcours jusqu'à la plus avancée
 *     d'entre elles (incluse), dans l'ordre PÉDAGOGIQUE (Section.ordre puis
 *     Lesson.ordre), pas l'ordre du Mushaf. Cocher Al-Masad (111, enseignée
 *     tard) marque donc acquis l'alphabet, les signes, Al-Fatiha, An-Nas,
 *     Al-Falaq, Al-Ikhlas… et la reprise se fait à la leçon suivante
 *     (An-Nasr). Cocher une sourate qu'on connaît implique qu'on maîtrise
 *     ce qui mène jusqu'à elle.
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

  // Sourates mémorisées → tout le parcours jusqu'à la plus avancée d'entre
  // elles. On cherche sa DERNIÈRE leçon dans l'ordre pédagogique, et on prend
  // tout ce qui vient avant (+ elle-même).
  const uniq = [...new Set(sourateNumeros)].filter((n) => Number.isInteger(n) && n >= 1 && n <= 114);
  if (uniq.length > 0) {
    const furthest = await prisma.lesson.findFirst({
      where: { sourateNumero: { in: uniq } },
      orderBy: [{ section: { ordre: 'desc' } }, { ordre: 'desc' }],
      select: { ordre: true, section: { select: { ordre: true } } },
    });
    if (furthest) {
      or.push({
        OR: [
          { section: { ordre: { lt: furthest.section.ordre } } },
          { section: { ordre: furthest.section.ordre }, ordre: { lte: furthest.ordre } },
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

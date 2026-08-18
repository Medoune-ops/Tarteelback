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
  // elles (incluse). Le repère de chaque sourate est sa PREMIÈRE leçon dans
  // l'ordre pédagogique, c'est-à-dire son point d'enseignement réel : une même
  // sourate peut réapparaître bien plus loin (Al-Fatiha est enseignée en
  // section 1 ET reprise en section 47, dernière du parcours). Viser sa
  // dernière occurrence marquait alors les 5341 leçons — tout le Coran —
  // dès qu'Al-Fatiha était cochée.
  const uniq = [...new Set(sourateNumeros)].filter((n) => Number.isInteger(n) && n >= 1 && n <= 114);
  if (uniq.length > 0) {
    const firstLessons = await prisma.lesson.findMany({
      where: { sourateNumero: { in: uniq } },
      orderBy: [{ section: { ordre: 'asc' } }, { ordre: 'asc' }],
      select: { sourateNumero: true, ordre: true, section: { select: { ordre: true } } },
      distinct: ['sourateNumero'],
    });
    // La plus avancée de ces premières occurrences borne le rattrapage.
    let furthest: { sectionOrdre: number; ordre: number } | null = null;
    for (const l of firstLessons) {
      const candidate = { sectionOrdre: l.section.ordre, ordre: l.ordre };
      if (
        !furthest ||
        candidate.sectionOrdre > furthest.sectionOrdre ||
        (candidate.sectionOrdre === furthest.sectionOrdre && candidate.ordre > furthest.ordre)
      ) {
        furthest = candidate;
      }
    }
    if (furthest) {
      or.push({
        OR: [
          { section: { ordre: { lt: furthest.sectionOrdre } } },
          { section: { ordre: furthest.sectionOrdre }, ordre: { lte: furthest.ordre } },
        ],
      });
      // Une sourate cochée s'étale sur plusieurs leçons consécutives (ex.
      // An-Nas = 3) : celles qui suivent la borne doivent l'être aussi pour que
      // getLearnedSourates la voie apprise en entier. On reste dans la section
      // de la borne — sans ça, la reprise tardive d'Al-Fatiha (section 47)
      // serait marquée elle aussi.
      or.push({
        sourateNumero: { in: uniq },
        section: { ordre: { lte: furthest.sectionOrdre } },
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

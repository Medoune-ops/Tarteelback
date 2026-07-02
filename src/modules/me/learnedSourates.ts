import { prisma } from '../../config/prisma.js';

/** A surah the user has learned, with the metadata the badge list needs. */
export interface LearnedSourate {
  id: string;
  numero: number;
  nom: string;
  nomArabe: string;
  nombreVersets: number;
  hizb: number;
  revelation: string | null;
}

/**
 * Surahs the user has learned "in full": a surah counts as learned when EVERY
 * lesson of a section that teaches it (via SectionSourate) is completed.
 *
 * Derived live from LessonProgress + SectionSourate — there is no dedicated
 * mastery table. Result is deduplicated by surah number and sorted ascending.
 */
export async function getLearnedSourates(userId: string): Promise<LearnedSourate[]> {
  const [sections, completed] = await Promise.all([
    prisma.section.findMany({
      include: {
        lessons: { select: { id: true } },
        sourateLinks: { include: { sourate: true } },
      },
    }),
    prisma.lessonProgress.findMany({
      where: { userId, etat: 'completed' },
      select: { lessonId: true },
    }),
  ]);

  const done = new Set(completed.map((c) => c.lessonId));
  const learned = new Map<number, LearnedSourate>();

  for (const section of sections) {
    // A section with no lessons can't be "finished"; skip it.
    if (section.lessons.length === 0) continue;
    if (!section.lessons.every((l) => done.has(l.id))) continue;
    for (const link of section.sourateLinks) {
      const s = link.sourate;
      learned.set(s.numero, {
        id: s.id,
        numero: s.numero,
        nom: s.nom,
        nomArabe: s.nomArabe,
        nombreVersets: s.nombreVersets,
        hizb: s.hizb,
        revelation: s.revelation,
      });
    }
  }

  return [...learned.values()].sort((a, b) => a.numero - b.numero);
}

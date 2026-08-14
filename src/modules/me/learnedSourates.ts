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
 * Surahs the user has learned "in full". Real generated content always tags
 * each surah's lessons with `Lesson.sourateNumero`, so the precise check is:
 * every lesson with `sourateNumero === s.numero` is completed — NOT every
 * lesson of the section it happens to be linked to via SectionSourate. A
 * section can bundle several surahs together (e.g. a hizb section spans
 * multiple short surahs) and onboarding's "already memorised" skip
 * (onboardingStart.ts#applyOnboardingStart) only completes the lessons of the
 * declared surah, not the whole section — checking the whole section used to
 * hide those surahs from the badge list, the SRS list, and stats forever.
 *
 * Fallback: a surah with zero `sourateNumero`-tagged lessons (no dedicated
 * lessons generated for it yet, only linked to a section via SectionSourate)
 * falls back to the old whole-section check, so surahs taught purely through
 * a shared section lesson aren't permanently unreachable.
 *
 * Derived live from LessonProgress — there is no dedicated mastery table.
 * Result is deduplicated by surah number and sorted ascending.
 */
export async function getLearnedSourates(userId: string): Promise<LearnedSourate[]> {
  const [sourates, taggedLessons, sectionLinks, completed] = await Promise.all([
    prisma.sourate.findMany(),
    prisma.lesson.findMany({
      where: { sourateNumero: { not: null } },
      select: { id: true, sourateNumero: true },
    }),
    prisma.sectionSourate.findMany({
      select: { sourateId: true, section: { select: { lessons: { select: { id: true } } } } },
    }),
    prisma.lessonProgress.findMany({
      where: { userId, etat: 'completed' },
      select: { lessonId: true },
    }),
  ]);

  const done = new Set(completed.map((c) => c.lessonId));
  const lessonsBySourateNumero = new Map<number, string[]>();
  for (const l of taggedLessons) {
    const arr = lessonsBySourateNumero.get(l.sourateNumero!) ?? [];
    arr.push(l.id);
    lessonsBySourateNumero.set(l.sourateNumero!, arr);
  }
  const sectionLessonsBySourateId = new Map<string, string[]>();
  for (const link of sectionLinks) {
    const arr = sectionLessonsBySourateId.get(link.sourateId) ?? [];
    arr.push(...link.section.lessons.map((l) => l.id));
    sectionLessonsBySourateId.set(link.sourateId, arr);
  }

  const learned: LearnedSourate[] = [];
  for (const s of sourates) {
    const taggedIds = lessonsBySourateNumero.get(s.numero);
    let ids = taggedIds;
    // No dedicated tagged lessons for this surah -> fall back to whichever
    // section links it (legacy content / test fixtures).
    if (!ids || ids.length === 0) ids = sectionLessonsBySourateId.get(s.id);
    if (!ids || ids.length === 0) continue;
    if (!ids.every((id) => done.has(id))) continue;
    learned.push({
      id: s.id,
      numero: s.numero,
      nom: s.nom,
      nomArabe: s.nomArabe,
      nombreVersets: s.nombreVersets,
      hizb: s.hizb,
      revelation: s.revelation,
    });
  }

  return learned.sort((a, b) => a.numero - b.numero);
}

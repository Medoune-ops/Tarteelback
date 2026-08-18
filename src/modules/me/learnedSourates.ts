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
  // Couleur de la section qui enseigne cette sourate (badge assorti à la
  // section plutôt qu'une couleur fixe) — celle de sa leçon la plus ancienne
  // (ordre le plus bas). null si la sourate n'a pas de leçon dédiée taguée
  // (fallback whole-section ci-dessous).
  couleur: string | null;
  degrade: [string, string] | null;
}

/**
 * Surahs the user has learned "in full". Real generated content always tags
 * each surah's lessons with `Lesson.sourateNumero`, so the precise check is:
 * every lesson with `sourateNumero === s.numero` is completed — NOT every
 * lesson of the section it happens to be linked to via SectionSourate. A
 * section can bundle several surahs together (e.g. a hizb section spans
 * multiple short surahs) and onboarding's "already memorised" skip
 * (onboardingStart.ts#applyOnboardingStart) only completes the lessons of
 * the declared surah(s), nothing else — checking the whole section used to
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
      select: {
        id: true,
        sourateNumero: true,
        ordre: true,
        section: { select: { ordre: true, couleur: true, degradeStart: true, degradeEnd: true } },
      },
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
  // Couleur de la leçon la plus ancienne (Section.ordre puis Lesson.ordre)
  // taguée pour chaque sourate — c'est la section "d'origine" du badge.
  const colorBySourateNumero = new Map<number, { couleur: string; degrade: [string, string] }>();
  const colorRankBySourateNumero = new Map<number, [number, number]>();
  for (const l of taggedLessons) {
    const num = l.sourateNumero!;
    const arr = lessonsBySourateNumero.get(num) ?? [];
    arr.push(l.id);
    lessonsBySourateNumero.set(num, arr);

    const rank: [number, number] = [l.section.ordre, l.ordre];
    const currentRank = colorRankBySourateNumero.get(num);
    if (!currentRank || rank[0] < currentRank[0] || (rank[0] === currentRank[0] && rank[1] < currentRank[1])) {
      colorRankBySourateNumero.set(num, rank);
      colorBySourateNumero.set(num, {
        couleur: l.section.couleur,
        degrade: [l.section.degradeStart, l.section.degradeEnd],
      });
    }
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
    const color = colorBySourateNumero.get(s.numero) ?? null;
    learned.push({
      id: s.id,
      numero: s.numero,
      nom: s.nom,
      nomArabe: s.nomArabe,
      nombreVersets: s.nombreVersets,
      hizb: s.hizb,
      revelation: s.revelation,
      couleur: color?.couleur ?? null,
      degrade: color?.degrade ?? null,
    });
  }

  return learned.sort((a, b) => a.numero - b.numero);
}

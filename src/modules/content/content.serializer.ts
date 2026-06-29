import type { LessonState } from '@prisma/client';

/**
 * Serializers that reproduce the front "mirror" shapes:
 *  - serializeSections() -> constants/parcours.ts `PARCOURS_SECTIONS`
 *  - serializeLesson()   -> constants/lessonEngine.ts `Lesson` (steps[])
 *
 * Node state (locked/active/completed) is derived from the user's
 * LessonProgress; the path "unlocks" lesson by lesson within a section, then
 * section by section — matching the Duolingo-style progression.
 */

const COMPLETED_ICONS = ['star', 'book', 'pen'] as const;
const LOCKED_ICONS = ['note', 'moon', 'trophy', 'kaaba', 'crescent'] as const;
const ALIGNS = ['left', 'right', 'center'] as const;

type ProgressMap = Map<string, LessonState>;

interface DbLessonLite {
  id: string;
  ordre: number;
  titre: string;
  iconType: string;
}

interface DbSection {
  id: string;
  ordre: number;
  hizb: number | null;
  kicker: string;
  titre: string;
  sousTitre: string;
  couleur: string;
  degradeStart: string;
  degradeEnd: string;
  headerIcon: string;
  lessons: DbLessonLite[];
  sourateLinks: {
    ordre: number;
    sourate: { numero: number; nom: string; nomArabe: string; nombreVersets: number };
  }[];
}

/**
 * Compute node state for a lesson. A lesson is `completed` if progress says so,
 * `active` if it's the first non-completed lesson of the first unfinished
 * section, otherwise `locked`.
 */
function buildNodes(
  section: DbSection,
  progress: ProgressMap,
  sectionIsActive: boolean,
) {
  // First non-completed index within this section.
  let activeIndex = -1;
  if (sectionIsActive) {
    activeIndex = section.lessons.findIndex(
      (l) => (progress.get(l.id) ?? 'locked') !== 'completed',
    );
  }

  return section.lessons.map((lesson, i) => {
    const stored = progress.get(lesson.id);
    let state: LessonState =
      stored === 'completed' ? 'completed' : i === activeIndex ? 'active' : 'locked';

    let icon: string;
    if (state === 'completed') icon = COMPLETED_ICONS[i % COMPLETED_ICONS.length]!;
    else if (state === 'active') icon = 'mosque';
    else icon = LOCKED_ICONS[i % LOCKED_ICONS.length]!;

    return {
      id: `${section.id}-n${i + 1}`,
      lessonId: state === 'locked' ? null : lesson.id,
      label: state === 'active' ? `Leçon ${i + 1}` : undefined,
      icon,
      align: state === 'active' ? 'center' : ALIGNS[i % ALIGNS.length]!,
      state,
    };
  });
}

export function serializeSections(sections: DbSection[], progress: ProgressMap) {
  // The "active" section is the first whose lessons aren't all completed.
  const firstUnfinished = sections.findIndex((s) =>
    s.lessons.some((l) => (progress.get(l.id) ?? 'locked') !== 'completed'),
  );

  return sections.map((s, idx) => ({
    id: s.id,
    ordre: s.ordre,
    hizb: s.hizb,
    kicker: s.kicker,
    titre: s.titre,
    sousTitre: s.sousTitre,
    couleur: s.couleur,
    degrade: [s.degradeStart, s.degradeEnd] as [string, string],
    headerIcon: s.headerIcon,
    sourates: s.sourateLinks.map((link) => ({
      numero: link.sourate.numero,
      nom: link.sourate.nom,
      nomArabe: link.sourate.nomArabe,
      nombreVersets: link.sourate.nombreVersets,
    })),
    nodes: buildNodes(s, progress, idx === firstUnfinished),
  }));
}

/**
 * Lesson steps as returned by GET /lessons/:id.
 * ANTI-CHEAT: the correct answer key (`bonneReponse` on written steps) is
 * stripped — judging happens only server-side via POST .../answer.
 */
export function serializeLesson(lesson: {
  id: string;
  titre: string;
  steps: { id: string; ordre: number; type: string; payload: unknown }[];
}) {
  return {
    id: lesson.id,
    titre: lesson.titre,
    steps: lesson.steps.map((step) => {
      const payload = { ...(step.payload as Record<string, unknown>) };
      // Never expose the answer key to the client.
      delete payload.bonneReponse;
      return {
        id: step.id,
        type: step.type,
        // Flattened so the client gets the same shape as the front's
        // LessonStep union (discovery/written/voice).
        ...payload,
      };
    }),
  };
}

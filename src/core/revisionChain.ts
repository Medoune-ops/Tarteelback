/**
 * RÉVISION GUIDÉE — chaînage progressif des versets d'une sourate, rejouant
 * l'ordre RÉEL d'apprentissage (Lesson.ordre + versetDebut/versetFin, cf.
 * lessonBuilder.ts#groupVerses : 1-2 versets par leçon selon leur longueur).
 *
 * Principe (pédagogie par blocs grandissants) :
 *   1. Récite le bloc déjà consolidé (vide au tout début).
 *   2. Apprends/récite la PROCHAINE leçon (1-2 nouveaux versets).
 *   3. Assemble : récite le bloc consolidé + les nouveaux versets ENSEMBLE.
 *   4. Le bloc consolidé grandit d'une leçon ; recommence à l'étape 1.
 *   jusqu'à ce que toutes les leçons de la sourate soient consolidées.
 *
 * Totalement indépendant du SRS par segment de 10 versets (core/revision.ts) :
 * celui-là gère la planification "quand revenir réviser", celui-ci gère
 * l'ORDRE et la STRUCTURE d'une session de consolidation initiale.
 */

export interface ChainLesson {
  ordre: number;
  versetDebut: number;
  versetFin: number;
}

export interface ChainStep {
  /** Bloc déjà consolidé (peut être vide au tout premier cycle). */
  blocConsolide: { debut: number; fin: number } | null;
  /** Nouveaux versets de la leçon à intégrer ce cycle. */
  nouveauxVersets: { debut: number; fin: number };
  /** Bloc assemblé à réciter d'un bloc pour terminer le cycle (consolidé + nouveaux). */
  blocAssemble: { debut: number; fin: number };
  /** Index (0-based) de la leçon qui vient d'être ajoutée, dans `lessons`. */
  lessonIndex: number;
}

export interface ChainState {
  /** Prochain pas à exécuter, ou null si toutes les leçons sont consolidées. */
  step: ChainStep | null;
  lessonsTotal: number;
  lessonsConsolidees: number;
  terminee: boolean;
}

/**
 * Calcule le pas de chaînage courant à partir des leçons de la sourate
 * (triées par `ordre`, donc par ordre réel d'apprentissage) et du nombre de
 * leçons déjà consolidées.
 */
export function computeChainStep(
  lessons: ChainLesson[],
  lessonsConsolidees: number,
): ChainState {
  const lessonsTotal = lessons.length;
  const clamped = Math.max(0, Math.min(lessonsConsolidees, lessonsTotal));
  const terminee = clamped >= lessonsTotal;

  if (terminee) {
    return { step: null, lessonsTotal, lessonsConsolidees: clamped, terminee: true };
  }

  const nextLesson = lessons[clamped]!;
  const blocConsolide = clamped === 0
    ? null
    : { debut: lessons[0]!.versetDebut, fin: lessons[clamped - 1]!.versetFin };

  const nouveauxVersets = { debut: nextLesson.versetDebut, fin: nextLesson.versetFin };
  const blocAssemble = {
    debut: blocConsolide ? blocConsolide.debut : nouveauxVersets.debut,
    fin: nouveauxVersets.fin,
  };

  return {
    step: { blocConsolide, nouveauxVersets, blocAssemble, lessonIndex: clamped },
    lessonsTotal,
    lessonsConsolidees: clamped,
    terminee: false,
  };
}

/**
 * Révision — SRS des sourates apprises + récitation vocale jugée par le
 * backend (Whisper).
 *
 * ⚠️ CONTRAT MIROIR (comme content.ts / lesson.ts) : le backend transcrit
 * l'audio (Whisper) puis compare au texte attendu du verset. Le client
 * n'évalue JAMAIS localement.
 *
 *  - GET  /me/revisions                          → sourates apprises + état SRS
 *        agrégé (segmentsTotal/segmentsDue, pire état, score moyen)
 *  - GET  /me/revisions/:idOrNumero/segments      → détail PAR SEGMENT (bloc de
 *        versets, cf. SEGMENT_SIZE côté backend) d'une sourate — sert à choisir
 *        quel segment réviser (le plus urgent).
 *  - POST /me/revisions/:idOrNumero/segments/:segmentIndex/review
 *      → enregistre facile/difficile/oublié pour CE segment, recalcule son
 *        planning SRS indépendamment des autres segments.
 *  - GET  /me/revisions/:idOrNumero/guided        → prochain pas de la révision
 *        GUIDÉE (chaînage progressif verset par verset, rejoue l'ordre RÉEL
 *        d'apprentissage — distinct du SRS par segment ci-dessus).
 *  - POST /me/revisions/:idOrNumero/guided/advance → clôture le cycle courant
 *        du chaînage ('facile'/'difficile' avance le curseur, 'oublie' répète).
 *  - GET  /me/revisions/lettres                   → leçons alphabet/harakat apprises + état SRS
 *  - POST /me/revisions/lettres/:lessonId/review  → enregistre facile/difficile/oublié,
 *        recalcule le planning SRS d'une leçon d'alphabet/harakat
 *  - POST /me/revisions/versets/:versetId/recite  (multipart `audio`)
 *      → { verdict, score, transcription? }       — révision libre (flashcard),
 *        aucun cœur en jeu.
 *  - POST /me/revisions/:idOrNumero/recite-range?debut=&fin= (multipart `audio`)
 *      → { verdict, score, transcription? }       — récitation ASSEMBLÉE de
 *        plusieurs versets consécutifs (chaînage libre ou guidé).
 *  - POST /lessons/:lessonId/steps/:stepId/answer-voice (multipart `audio`)
 *      → judging serveur d'une étape 'voice' de leçon, même sémantique de
 *        cœurs que answerStep (faux = −1 cœur, 403 OUT_OF_HEARTS si plus de
 *        cœurs).
 *
 * `versetId` est le **cuid réel** du verset (renvoyé par GET
 * /sourates/:id/versets), jamais un numéro local. `idOrNumero` (review,
 * segments, guided, recite-range) accepte le cuid de la sourate OU son numéro
 * (1–114).
 */
import { apiFetch } from './client';

/** Sourate apprise + état SRS AGRÉGÉ tous segments confondus (GET /me/revisions). */
export interface SourateRevisionView {
  numero: number;
  nom: string;
  nomArabe: string;
  nombreVersets: number;
  /** Nombre total de segments (blocs de versets) découpant cette sourate. */
  segmentsTotal: number;
  /** Segments dont la révision est due maintenant (jamais révisé ou échéance passée). */
  segmentsDue: number;
  /** Score moyen (0–100) tous segments confondus. */
  score: number;
  /** Le PIRE état parmi les segments — ne masque jamais un segment fragile. */
  etat: 'maitrise' | 'revoir' | 'difficile';
  derniereRevision: string | null;
  prochaineRevision: string | null;
}

/** Un segment (bloc de versets) du SRS classique d'une sourate. */
export interface SegmentRevisionView {
  segmentIndex: number;
  debut: number;
  fin: number;
  score: number;
  etat: 'maitrise' | 'revoir' | 'difficile';
  derniereRevision: string | null;
  prochaineRevision: string | null;
}

/** GET /me/revisions/:idOrNumero/segments — détail par bloc d'une sourate. */
export interface SourateSegmentsView {
  numero: number;
  nom: string;
  nomArabe: string;
  nombreVersets: number;
  segments: SegmentRevisionView[];
}

export type RevisionQuality = 'facile' | 'difficile' | 'oublie';

/** Un pas de la révision GUIDÉE (chaînage progressif verset par verset). */
export interface GuidedRevisionView {
  numero: number;
  nom: string;
  nomArabe: string;
  /** Nombre total de leçons de versets de cette sourate (= nb de "crans" du chaînage). */
  lessonsTotal: number;
  /** Nombre de leçons déjà consolidées (curseur actuel). */
  lessonsConsolidees: number;
  /** true = chaînage terminé, toute la sourate a été assemblée d'un bloc. */
  terminee: boolean;
  /** null quand `terminee` est true — sinon le pas courant à réviser. */
  step: {
    /** Bloc déjà consolidé (versets déjà soudés) — null au tout premier pas. */
    blocConsolide: { debut: number; fin: number } | null;
    /** Les 1-2 nouveaux versets à réviser/apprendre à ce pas. */
    nouveauxVersets: { debut: number; fin: number };
    /** Bloc à réciter D'UN BLOC (ancien + nouveaux assemblés) via recite-range. */
    blocAssemble: { debut: number; fin: number };
    lessonIndex: number;
  } | null;
}

/** Leçon d'alphabet/harakat apprise + état SRS (GET /me/revisions/lettres). */
export interface LettreRevisionView {
  lessonId: string;
  titre: string;
  ordre: number;
  score: number;
  etat: 'maitrise' | 'revoir' | 'difficile';
  derniereRevision: string | null;
  prochaineRevision: string | null;
}

/** Upload + transcription Whisper : on laisse le temps au serveur. */
const RECITE_TIMEOUT_MS = 45_000;

/** Verdict du serveur sur la récitation d'UN verset (révision libre). */
export interface ReciteVersetResult {
  /** fluide = récité sans erreur · hesitant = approximatif · oublie = raté. */
  verdict: 'fluide' | 'hesitant' | 'oublie';
  /** Similarité texte attendu / texte reconnu, 0–100. */
  score: number;
  /** Texte reconnu par Whisper (affichage/debug, optionnel). */
  transcription?: string;
}

/** Verdict du serveur pour une étape 'voice' de leçon (judging autoritaire). */
export interface ReciteStepResult {
  correct: boolean;
  score?: number;
}

/** Construit le corps multipart avec le fichier audio local (uri expo-audio). */
function audioForm(uri: string): FormData {
  const form = new FormData();
  // React Native accepte { uri, name, type } comme valeur de fichier.
  form.append('audio', {
    uri,
    name: 'recitation.m4a',
    type: 'audio/m4a',
  } as unknown as Blob);
  return form;
}

/** GET /me/revisions — sourates apprises + état SRS. */
export async function fetchRevisions(): Promise<SourateRevisionView[]> {
  const data = await apiFetch<{ revisions: SourateRevisionView[] }>('/me/revisions');
  return data.revisions;
}

/**
 * POST /me/revisions/:idOrNumero/review — enregistre le résultat
 * d'auto-évaluation d'une session de révision (facile/difficile/oublié) et
 * recalcule le planning SRS.
 */
export async function reviewSourate(
  idOrNumero: string | number,
  quality: RevisionQuality,
): Promise<SourateRevisionView> {
  return apiFetch<SourateRevisionView>(`/me/revisions/${idOrNumero}/review`, {
    method: 'POST',
    json: { quality },
  });
}

/**
 * GET /me/revisions/:idOrNumero/segments — détail par segment (bloc de
 * versets) du SRS d'une sourate apprise. Sert à cibler le segment le plus
 * urgent (échéance la plus proche) plutôt que la moyenne agrégée de la liste.
 */
export async function fetchSourateSegments(idOrNumero: string | number): Promise<SourateSegmentsView> {
  return apiFetch<SourateSegmentsView>(`/me/revisions/${idOrNumero}/segments`);
}

/**
 * POST /me/revisions/:idOrNumero/segments/:segmentIndex/review — enregistre
 * le résultat d'auto-évaluation d'UN segment (SRS classique) et recalcule son
 * planning indépendamment des autres segments de la sourate.
 */
export async function reviewSegment(
  idOrNumero: string | number,
  segmentIndex: number,
  quality: RevisionQuality,
): Promise<SegmentRevisionView> {
  return apiFetch<SegmentRevisionView>(`/me/revisions/${idOrNumero}/segments/${segmentIndex}/review`, {
    method: 'POST',
    json: { quality },
  });
}

/**
 * GET /me/revisions/:idOrNumero/guided — prochain pas de la révision GUIDÉE
 * (chaînage progressif verset par verset, rejoue l'ordre RÉEL d'apprentissage).
 * 403 si la sourate n'est pas encore apprise.
 */
export async function fetchGuidedRevision(idOrNumero: string | number): Promise<GuidedRevisionView> {
  return apiFetch<GuidedRevisionView>(`/me/revisions/${idOrNumero}/guided`);
}

/**
 * POST /me/revisions/:idOrNumero/guided/advance — clôture le cycle courant du
 * chaînage : 'facile'/'difficile' avance le curseur (le bloc assemblé devient
 * le nouveau bloc consolidé) ; 'oublie' répète le même cycle. 400 si déjà
 * `terminee`, 403 si la sourate n'est pas encore apprise.
 */
export async function advanceGuidedRevision(
  idOrNumero: string | number,
  quality: RevisionQuality,
): Promise<GuidedRevisionView> {
  return apiFetch<GuidedRevisionView>(`/me/revisions/${idOrNumero}/guided/advance`, {
    method: 'POST',
    json: { quality },
  });
}

/** GET /me/revisions/lettres — leçons alphabet/harakat apprises + état SRS. */
export async function fetchLettreRevisions(): Promise<LettreRevisionView[]> {
  const data = await apiFetch<{ revisions: LettreRevisionView[] }>('/me/revisions/lettres');
  return data.revisions;
}

/**
 * POST /me/revisions/lettres/:lessonId/review — enregistre le résultat
 * d'auto-évaluation d'une révision alphabet/harakat et recalcule le planning SRS.
 */
export async function reviewLettre(
  lessonId: string,
  quality: RevisionQuality,
): Promise<LettreRevisionView> {
  return apiFetch<LettreRevisionView>(`/me/revisions/lettres/${lessonId}/review`, {
    method: 'POST',
    json: { quality },
  });
}

/**
 * POST /me/revisions/lettres/steps/:stepId/recite — juge la prononciation
 * d'une lettre/syllabe (flashcard alphabet/harakat). Même sémantique que
 * reciteVerset : verdict Whisper serveur, jamais de cœur en jeu.
 */
export async function reciteLettreStep(stepId: string, audioUri: string): Promise<ReciteVersetResult> {
  return apiFetch<ReciteVersetResult>(`/me/revisions/lettres/steps/${stepId}/recite`, {
    method: 'POST',
    formData: audioForm(audioUri),
    timeoutMs: RECITE_TIMEOUT_MS,
  });
}

/** POST /me/revisions/versets/:versetId/recite — juge la récitation d'un verset. */
export async function reciteVerset(versetId: string, audioUri: string): Promise<ReciteVersetResult> {
  return apiFetch<ReciteVersetResult>(`/me/revisions/versets/${versetId}/recite`, {
    method: 'POST',
    formData: audioForm(audioUri),
    timeoutMs: RECITE_TIMEOUT_MS,
  });
}

/**
 * POST /me/revisions/:idOrNumero/recite-range?debut=&fin= — juge la
 * récitation ASSEMBLÉE de plusieurs versets consécutifs (`debut`/`fin`
 * inclusifs, 1-based) — exercice de chaînage, utilisé par la révision libre
 * (bloc de segment) ET la révision guidée (bloc assemblé).
 */
export async function reciteVersetRange(
  idOrNumero: string | number,
  debut: number,
  fin: number,
  audioUri: string,
): Promise<ReciteVersetResult> {
  return apiFetch<ReciteVersetResult>(
    `/me/revisions/${idOrNumero}/recite-range?debut=${debut}&fin=${fin}`,
    {
      method: 'POST',
      formData: audioForm(audioUri),
      timeoutMs: RECITE_TIMEOUT_MS,
    },
  );
}

/** POST /lessons/:id/steps/:stepId/answer-voice — juge l'étape 'voice' d'une leçon. */
export async function reciteLessonStep(
  lessonId: string,
  stepId: string,
  audioUri: string,
): Promise<ReciteStepResult> {
  return apiFetch<ReciteStepResult>(`/lessons/${lessonId}/steps/${stepId}/answer-voice`, {
    method: 'POST',
    formData: audioForm(audioUri),
    timeoutMs: RECITE_TIMEOUT_MS,
  });
}

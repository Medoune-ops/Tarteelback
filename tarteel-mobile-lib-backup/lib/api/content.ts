/**
 * Lecture du contenu d'apprentissage depuis l'API.
 *
 *  - GET /sections        → parcours complet (états des nœuds personnalisés si
 *                           connecté). Forme identique à `ParcoursSection`
 *                           (constants/parcours.ts) — c'est le contrat miroir.
 *  - GET /lessons/:id     → une leçon avec sa séquence d'étapes (sans la clé de
 *                           réponse : le judging est server-side). Forme
 *                           identique à `Lesson` (constants/lessonEngine.ts).
 *
 * Le `lessonId` porté par chaque nœud (`node.lessonId`) est le **cuid réel** en
 * base — c'est lui qu'il faut passer au judging et à la complétion, jamais un
 * id de séquence local.
 */
import { apiFetch } from './client';
import type { ParcoursSection } from '../../constants/parcours';
import type { Lesson } from '../../constants/lessonEngine';

/**
 * GET /sections — parcours complet, états personnalisés pour l'utilisateur.
 * `lang` résout le texte des sections/leçons (titres, kicker…) dans la langue
 * de l'utilisateur — même paramètre que fetchLesson/fetchVersets. Sans `lang`,
 * le serveur retombe sur Accept-Language puis DEFAULT_LANG.
 */
export async function fetchSections(lang?: string): Promise<ParcoursSection[]> {
  const q = lang ? `?lang=${lang}` : '';
  const data = await apiFetch<{ sections: ParcoursSection[] }>(`/sections${q}`);
  return data.sections;
}

/**
 * GET /lessons/:id — la leçon et ses étapes (clé de réponse retirée). `lang`
 * résout le texte des consignes (ex: "Quelle lettre est-ce ?") dans la langue
 * de l'utilisateur — même paramètre que `fetchVersets`. Sans `lang`, le
 * serveur retombe sur Accept-Language puis DEFAULT_LANG.
 */
export async function fetchLesson(lessonId: string, lang?: string): Promise<Lesson> {
  const q = lang ? `?lang=${lang}` : '';
  const data = await apiFetch<{ lesson: Lesson }>(`/lessons/${lessonId}${q}`);
  return data.lesson;
}

// ─── Métadonnées d'une sourate ───────────────────────────────────────────────

/** Une sourate (métadonnées seules) — sert au badge « Sourates apprises ». */
export interface SourateListItem {
  id: string;
  numero: number;         // 1–114
  nom: string;            // nom latin, ex: "Al-Fatiha"
  nomArabe: string;
  nombreVersets: number;
  hizb: number;
  revelation: string | null; // "makkah" | "madinah" | null
  /** Position d'enseignement dans le parcours (0-based), PAS l'ordre du
   *  Mushaf — ex: Al-Fatiha (1) vient juste après l'alphabet, avant An-Nas
   *  (114). null si la sourate n'est pas encore enseignée par une leçon. */
  ordreParcours: number | null;
}

/** GET /sourates — les 114 sourates (métadonnées), contenu quasi-immuable. */
export async function fetchSourates(): Promise<SourateListItem[]> {
  const data = await apiFetch<{ sourates: SourateListItem[] }>('/sourates');
  return data.sourates;
}

// ─── Lecture du Coran (mot par mot) ──────────────────────────────────────────

/** Un mot d'un verset, avec sa propre récitation. */
export interface VersetMot {
  position: number;
  texteArabe: string;
  audioUrl: string | null;
}

/** Un verset avec sa traduction, sa translittération et ses mots. */
export interface Verset {
  id: string;
  numero: number;
  texteArabe: string;
  audioUrl: string | null;
  traduction: { texte: string; langue: string; source: string } | null;
  translitteration: { texte: string; langue: string; source: string } | null;
  mots: VersetMot[];
}

export interface SourateVersets {
  sourate: {
    id: string;
    numero: number;
    nom: string;
    nomArabe: string;
    nombreVersets: number;
    hizb: number;
    revelation: string | null;
  };
  lang: string;
  versets: Verset[];
}

/**
 * GET /sourates/:idOrNumero/versets — versets d'une sourate avec traduction
 * dans la langue de l'utilisateur ET l'audio mot par mot (lecteur tappable).
 * `id` accepte le cuid ou le numéro de sourate (1–114).
 */
export async function fetchVersets(idOrNumero: string | number, lang?: string): Promise<SourateVersets> {
  const q = lang ? `?lang=${lang}` : '';
  return apiFetch<SourateVersets>(`/sourates/${idOrNumero}/versets${q}`);
}

import type { RevisionState } from '@prisma/client';

/**
 * SRS des sourates apprises — version "lite" : pas d'easiness factor façon
 * SM-2 complet, juste un score 0-100 (même convention que
 * `LessonProgress.score`) et un intervalle en jours qui double/rétrécit selon
 * l'auto-évaluation déclarée par l'utilisateur en fin de session.
 */

export type RevisionQuality = 'facile' | 'difficile' | 'oublie';

const MIN_INTERVAL_DAYS = 1;
const MAX_INTERVAL_DAYS = 90;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Découpage en blocs de mémorisation : SEGMENT_SIZE versets CONSÉCUTIFS par
 * bloc (0-based). Une sourate courte (≤ SEGMENT_SIZE versets, ex. Al-Fatiha)
 * tient dans un seul segment ; une longue (ex. Al-Baqara, 286 versets) est
 * découpée en plusieurs — chacun suivi par sa propre ligne SRS, pour isoler
 * les segments fragiles des segments maîtrisés au lieu de tout traiter comme
 * un bloc unique.
 */
export const SEGMENT_SIZE = 10;

/** Nombre de segments d'une sourate de `nombreVersets` versets. */
export function segmentCount(nombreVersets: number): number {
  return Math.max(1, Math.ceil(nombreVersets / SEGMENT_SIZE));
}

/** Bornes (1-based, inclusives) des versets couverts par un segment donné. */
export function segmentVerseRange(
  segmentIndex: number,
  nombreVersets: number,
): { debut: number; fin: number } {
  const debut = segmentIndex * SEGMENT_SIZE + 1;
  const fin = Math.min(debut + SEGMENT_SIZE - 1, nombreVersets);
  return { debut, fin };
}

export interface RevisionSrsState {
  score: number;
  intervalleJours: number;
}

export interface RevisionSrsResult extends RevisionSrsState {
  etat: RevisionState;
  prochaineRevision: Date;
}

export function computeNextRevision(
  current: RevisionSrsState,
  quality: RevisionQuality,
  now: Date = new Date(),
): RevisionSrsResult {
  let { score, intervalleJours } = current;

  if (quality === 'facile') {
    score = Math.min(100, score + 15);
    intervalleJours = Math.min(MAX_INTERVAL_DAYS, Math.round(intervalleJours * 2.2));
  } else if (quality === 'difficile') {
    score = Math.max(0, score - 5);
    intervalleJours = Math.max(MIN_INTERVAL_DAYS, Math.round(intervalleJours * 1.2));
  } else {
    score = Math.max(0, score - 25);
    intervalleJours = MIN_INTERVAL_DAYS;
  }

  const etat: RevisionState = score >= 80 ? 'maitrise' : score >= 40 ? 'revoir' : 'difficile';
  const prochaineRevision = new Date(now.getTime() + intervalleJours * DAY_MS);

  return { score, intervalleJours, etat, prochaineRevision };
}

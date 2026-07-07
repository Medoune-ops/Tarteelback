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

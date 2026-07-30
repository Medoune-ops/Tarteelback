/**
 * Ligues : classement hebdomadaire de l'utilisateur.
 *
 * GET /leagues/me renvoie la vue de classement autour de l'utilisateur
 * (podium top-3 + voisins), calculée côté serveur. Si l'utilisateur n'a pas
 * encore rejoint de semaine (`joined: false`), on l'inscrit via POST
 * /leagues/join puis on relit.
 */
import { apiFetch } from './client';

/** Un participant du classement (podium ou voisinage). */
export interface LeagueMember {
  rang: number;
  userId: string;
  name: string;
  initials: string;
  weeklyXp: number;
  me: boolean;
  promotion: boolean;
  relegation: boolean;
}

export interface LeagueView {
  joined: boolean;
  league: { id: string; nom: string; niveau: number } | null;
  semaine: number | null;
  participants: number;
  msUntilEnd: number;
  myRank: number | null;
  podium: LeagueMember[];
  around: LeagueMember[];
  promotionZone: number;
  relegationZone: number;
}

/** GET /leagues/me — vue de classement de la semaine courante. */
export async function fetchMyLeague(): Promise<LeagueView> {
  return apiFetch<LeagueView>('/leagues/me');
}

/** POST /leagues/join — inscrit l'utilisateur à la semaine en cours, renvoie la vue. */
export async function joinLeague(): Promise<LeagueView> {
  return apiFetch<LeagueView>('/leagues/join', { method: 'POST' });
}

/**
 * Vue de ligue prête à afficher : récupère /leagues/me, et si l'utilisateur
 * n'a pas encore rejoint, l'inscrit automatiquement puis renvoie la vue à jour.
 */
export async function getOrJoinLeague(): Promise<LeagueView> {
  const view = await fetchMyLeague();
  if (view.joined) return view;
  return joinLeague();
}

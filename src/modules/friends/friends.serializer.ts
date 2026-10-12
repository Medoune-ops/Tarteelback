import type { LearnedSourate } from '../me/learnedSourates.js';

/**
 * Profil public d'un utilisateur — LISTE BLANCHE (règle 6). Un ami ne voit
 * JAMAIS l'email, le fuseau horaire, les gemmes, les cœurs ni l'abonnement.
 *
 * C'est le seul type d'utilisateur qui franchit la frontière « ami → ami ».
 * `serializePublicUser` est LA seule fonction de sérialisation autorisée : tous
 * les modules amis passent par elle (liste, classement, activité, défis, inbox).
 * Les colonnes lues en base sont aussi limitées par `friendUserSelect`
 * (friends.repository.ts) — double protection lecture + sortie.
 */
export interface FriendUserView {
  id: string;
  displayName: string;
  username: string | null;
  avatarInitials: string;
}

/** Ligne d'utilisateur brute — on tolère un superset, on ne recopie que la liste. */
export interface PublicUserRow {
  id: string;
  displayName: string;
  username: string | null;
  avatarInitials: string;
}

/**
 * Unique point de sortie d'un profil public. Toute donnée hors liste blanche
 * (email, timezone, gems, hearts, isPremium, abonnement…) est supprimée, même
 * si elle est présente sur l'objet d'entrée.
 */
export function serializePublicUser(row: PublicUserRow): FriendUserView {
  return {
    id: row.id,
    displayName: row.displayName,
    username: row.username,
    avatarInitials: row.avatarInitials,
  };
}

export interface FriendView {
  friendshipId: string;
  user: FriendUserView;
  /** Date d'ajout (ISO). */
  since: string;
}

interface FriendshipRow {
  id: string;
  user1Id: string;
  user2Id: string;
  createdAt: Date;
  user1: PublicUserRow;
  user2: PublicUserRow;
}

/** Sérialise une amitié en vue « ami » du point de vue de `meId`. */
export function serializeFriend(row: FriendshipRow, meId: string): FriendView {
  const other = row.user1Id === meId ? row.user2 : row.user1;
  return {
    friendshipId: row.id,
    user: serializePublicUser(other),
    since: row.createdAt.toISOString(),
  };
}

/** Progrès d'un ami (streak, XP de la semaine, sourates maîtrisées). */
export interface FriendProgressView {
  user: FriendUserView;
  streak: number;
  weeklyXp: number;
  masteredSourates: number;
  masteredSourateNumeros: number[];
}

export function serializeFriendProgress(
  user: PublicUserRow & { streak: number; weeklyXp: number },
  learned: LearnedSourate[],
): FriendProgressView {
  return {
    user: serializePublicUser(user),
    streak: user.streak,
    weeklyXp: user.weeklyXp,
    masteredSourates: learned.length,
    masteredSourateNumeros: learned.map((s) => s.numero),
  };
}

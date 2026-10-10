import type { LearnedSourate } from '../me/learnedSourates.js';

/** Profil public minimal d'un utilisateur (jamais d'email). */
export interface FriendUserView {
  id: string;
  displayName: string;
  username: string | null;
  avatarInitials: string;
}

export interface FriendView {
  friendshipId: string;
  user: FriendUserView;
  /** Date d'ajout (ISO). */
  since: string;
}

interface FriendUserRow {
  id: string;
  displayName: string;
  username: string | null;
  avatarInitials: string;
}

interface FriendshipRow {
  id: string;
  user1Id: string;
  user2Id: string;
  createdAt: Date;
  user1: FriendUserRow;
  user2: FriendUserRow;
}

/** Sérialise une amitié en vue « ami » du point de vue de `meId`. */
export function serializeFriend(row: FriendshipRow, meId: string): FriendView {
  const other = row.user1Id === meId ? row.user2 : row.user1;
  return {
    friendshipId: row.id,
    user: other,
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
  user: FriendUserRow & { streak: number; weeklyXp: number },
  learned: LearnedSourate[],
): FriendProgressView {
  return {
    user: {
      id: user.id,
      displayName: user.displayName,
      username: user.username,
      avatarInitials: user.avatarInitials,
    },
    streak: user.streak,
    weeklyXp: user.weeklyXp,
    masteredSourates: learned.length,
    masteredSourateNumeros: learned.map((s) => s.numero),
  };
}

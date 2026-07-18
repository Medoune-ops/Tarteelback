import { isPremiumActive } from '../../core/premium.js';
import { snapshot } from '../../core/hearts.js';
import type { AdminUserListRow } from './adminUsers.repository.js';

/**
 * Shape returned by GET /admin/users, matching what the back-office table
 * needs: no password hash, hearts freshly computed (same contract as the
 * mobile /me), league name resolved from the latest membership if any.
 */
export function serializeAdminUser(row: AdminUserListRow, now: Date = new Date()) {
  const premium = isPremiumActive({ isPremium: row.isPremium, premiumUntil: row.premiumUntil }, now);
  const hearts = snapshot({ hearts: row.hearts, lastHeartLossAt: row.lastHeartLossAt }, premium, now);
  const league = row.leagueMemberships[0]?.leagueWeek.league ?? null;

  return {
    id: row.id,
    email: row.email,
    displayName: row.displayName,
    avatarInitials: row.avatarInitials,
    xp: row.weeklyXp,
    streak: row.streak,
    hearts: hearts.hearts,
    gems: row.gems,
    isPremium: premium,
    premiumUntil: row.premiumUntil ? row.premiumUntil.toISOString() : null,
    league: league ? { name: league.nom, tier: league.niveau } : null,
    isBanned: row.bannedAt != null,
    bannedAt: row.bannedAt ? row.bannedAt.toISOString() : null,
    bannedReason: row.bannedReason,
    createdAt: row.createdAt.toISOString(),
  };
}

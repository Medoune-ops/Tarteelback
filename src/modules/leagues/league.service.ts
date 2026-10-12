import type { Prisma } from '@prisma/client';
import { AppError } from '../../core/errors.js';
import { leagueRepository } from './league.repository.js';
import {
  setRankXp,
  countMembers,
  rankOf,
  ensureWarm,
  top as topMembers,
  range as rangeMembers,
} from './league.ranking.js';

const PROMOTION_ZONE = 3; // top 3 promote
const RELEGATION_ZONE = 5; // bottom 5 relegate
const WINDOW_BEFORE = 2; // members shown above the user
const WINDOW_AFTER = 3; // members shown below the user

type Member = {
  userId: string;
  weeklyXp: number;
  user: { displayName: string; avatarInitials: string; username: string | null };
};

function shape(m: Member, rang: number, meId: string, total: number) {
  return {
    rang,
    userId: m.userId,
    // Classement public → pseudo choisi à l'inscription ; le nom complet
    // reste privé (fallback pour les comptes créés avant le champ username).
    name: m.user.username ?? m.user.displayName,
    initials: m.user.avatarInitials,
    weeklyXp: m.weeklyXp,
    me: m.userId === meId,
    promotion: rang <= PROMOTION_ZONE,
    relegation: total > RELEGATION_ZONE && rang > total - RELEGATION_ZONE,
  };
}

export const leagueService = {
  /** POST /leagues/join — enrol the user in the lowest league's current week. */
  async join(userId: string, currentWeeklyXp: number) {
    const week = await leagueRepository.lowestActiveWeek();
    if (!week) throw new AppError('NOT_FOUND', 'No active league week');
    await leagueRepository.joinWeek(userId, week.id, currentWeeklyXp);
    // Seed the Redis sorted set so the user appears in the ranking immediately.
    await setRankXp(week.id, userId, currentWeeklyXp);
    return this.me(userId);
  },

  /**
   * Resolve the user's CURRENT active league week, auto-enrolling them into the
   * lowest league's active week if they aren't a member of any active week yet.
   * Returns the `leagueWeekId` the XP should be attributed to, or null when no
   * active league week exists at all. Runs inside the caller's transaction.
   *
   * Auto-enrol keeps `User.weeklyXp` (Learn screen) and
   * `LeagueMembership.weeklyXp` (League screen) on the same week, so the two
   * projections recomputed from the XpEvent ledger can never diverge.
   */
  async ensureWeekMembershipTx(
    tx: Prisma.TransactionClient,
    userId: string,
  ): Promise<string | null> {
    const now = new Date();
    const active = await tx.leagueWeek.findFirst({
      where: {
        dateDebut: { lte: now },
        dateFin: { gt: now },
        memberships: { some: { userId } },
      },
      select: { id: true },
    });
    if (active) return active.id;

    // Not enrolled anywhere for the current week — auto-join the lowest
    // league's active week (mirrors POST /leagues/join), starting from 0.
    const lowest = await tx.leagueWeek.findFirst({
      where: { dateDebut: { lte: now }, dateFin: { gt: now } },
      orderBy: [{ league: { ordre: 'asc' } }, { dateDebut: 'desc' }],
      select: { id: true },
    });
    if (!lowest) return null; // no league weeks exist at all — nothing to join
    await tx.leagueMembership.upsert({
      where: { userId_leagueWeekId: { userId, leagueWeekId: lowest.id } },
      create: { userId, leagueWeekId: lowest.id, weeklyXp: 0 },
      update: {},
    });
    return lowest.id;
  },

  /**
   * Mirror the RECOMPUTED weekly XP (absolute value, never a delta) into the
   * Redis ranking. Call after the DB tx commits. Uses ZADD (set), so replaying
   * the same recomputation is harmless — the projection can't drift upward.
   */
  async mirrorRankXp(weekId: string, userId: string, weeklyXp: number) {
    await setRankXp(weekId, userId, weeklyXp);
  },

  /**
   * GET /leagues/me — ranking view around the user, computed in O(log n):
   * a COUNT for the rank, a LIMIT for the podium, and a small OFFSET page for
   * the neighbours. Never loads the whole league into memory.
   */
  async me(userId: string) {
    const week = await leagueRepository.currentWeekForUser(userId);
    if (!week) {
      // Not enrolled in any active week.
      return { joined: false, league: null, semaine: null, participants: 0, msUntilEnd: 0, myRank: null, podium: [], around: [], promotionZone: PROMOTION_ZONE, relegationZone: RELEGATION_ZONE };
    }

    // Self-heal the Redis projection if it drifted from the DB (cold cache, or
    // memberships created outside the app), then read the ranking from it.
    await ensureWarm(week.id);

    // Ranking served from Redis sorted sets (O(log n), scales to millions),
    // with automatic SQL fallback when Redis is unavailable.
    const [total, myRank, topRows] = await Promise.all([
      countMembers(week.id),
      rankOf(week.id, userId),
      topMembers(week.id, 3),
    ]);

    const podium = topRows.map((m, i) => shape(m, i + 1, userId, total));

    // Neighbour window around the user's rank.
    let around: ReturnType<typeof shape>[] = [];
    if (myRank != null) {
      const startRank = Math.max(1, myRank - WINDOW_BEFORE);
      const rows = await rangeMembers(
        week.id,
        startRank - 1,
        startRank - 1 + WINDOW_BEFORE + WINDOW_AFTER,
      );
      around = rows.map((m, i) => shape(m, startRank + i, userId, total));
    }

    return {
      joined: true,
      league: { id: week.league.id, nom: week.league.nom, niveau: week.league.niveau },
      semaine: week.numeroSemaine,
      participants: total,
      msUntilEnd: Math.max(0, week.dateFin.getTime() - Date.now()),
      myRank,
      podium,
      around,
      promotionZone: PROMOTION_ZONE,
      relegationZone: RELEGATION_ZONE,
    };
  },

  listLeagues() {
    return leagueRepository.leagues();
  },
};

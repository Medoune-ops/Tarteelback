import type { Prisma } from '@prisma/client';
import { AppError } from '../../core/errors.js';
import { leagueRepository } from './league.repository.js';
import {
  bumpRankXp,
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
   * Add weekly XP to the user's CURRENT active membership, inside the caller's
   * transaction (so it can't diverge from the user's weeklyXp counter).
   *
   * Auto-enrols the user into the lowest league's active week if they aren't
   * a member of any active week yet — this keeps `User.weeklyXp` (shown on the
   * Learn screen) and `LeagueMembership.weeklyXp` (shown on the League screen)
   * from silently drifting apart. Without this, a user who never joined (or
   * whose last league week ended without rejoining) keeps earning XP on the
   * Learn screen while the League screen stays frozen, with no error anywhere.
   *
   * Still a no-op if there is genuinely no active league week at all (e.g. no
   * leagues seeded yet) — nothing to enrol into.
   *
   * Returns {weekId, amount} so the caller can mirror the increment into Redis
   * AFTER the tx commits.
   */
  async addXpIfMemberTx(
    tx: Prisma.TransactionClient,
    userId: string,
    amount: number,
  ): Promise<{ weekId: string; amount: number } | null> {
    if (amount === 0) return null;
    const now = new Date();
    let week = await tx.leagueWeek.findFirst({
      where: {
        dateDebut: { lte: now },
        dateFin: { gt: now },
        memberships: { some: { userId } },
      },
      select: { id: true },
    });

    if (!week) {
      // Not enrolled anywhere for the current week — auto-join the lowest
      // league's active week (mirrors POST /leagues/join), starting from 0:
      // this XP gain becomes their first contribution to the new membership.
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
      week = lowest;
    }

    await tx.leagueMembership.updateMany({
      where: { userId, leagueWeekId: week.id },
      data: { weeklyXp: { increment: amount } },
    });
    return { weekId: week.id, amount };
  },

  /** Mirror an XP gain into the Redis ranking (call after the DB tx commits). */
  async mirrorRankXp(weekId: string, userId: string, amount: number) {
    await bumpRankXp(weekId, userId, amount);
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

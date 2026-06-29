/**
 * Weekly league rollover. Run on a schedule (cron / a worker) at the end of
 * each league week:
 *   - rank everyone in the closing week by weeklyXp;
 *   - top 3 promote one tier, bottom 5 relegate one tier;
 *   - reset weeklyXp for the new week;
 *   - open the next LeagueWeek for each league.
 *
 * Safe in multi-instance deployments:
 *   - a Postgres ADVISORY LOCK ensures only one runner processes the rollover
 *     at a time;
 *   - `closedAt` makes it idempotent: an already-closed week is never
 *     re-processed (no double promotion / weeklyXp reset wipe);
 *   - each week is closed in its own transaction;
 *   - members are processed in batches to bound memory and pool usage.
 *
 * Invoke with: `tsx src/modules/leagues/league.cron.ts`
 */
import { prisma } from '../../config/prisma.js';
import { withLock } from '../../core/lock.js';
import { PODIUM_REWARD } from '../../core/rewards.js';

const PODIUM_XP = PODIUM_REWARD;
const PROMOTION = 3;
const RELEGATION = 5;
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const BATCH = 1000;
const LOCK_TTL_MS = 10 * 60 * 1000; // generous: a rollover may take minutes

export async function runWeeklyRollover(now: Date = new Date()) {
  // Distributed lock: Redis when present, Postgres advisory lock otherwise.
  // Only one instance/runner processes the rollover at a time.
  const result = await withLock('league-rollover', LOCK_TTL_MS, async () => {
    const leagues = await prisma.league.findMany({ orderBy: { ordre: 'asc' } });
    if (leagues.length === 0) return { closed: 0, opened: 0 };
    const byOrdre = new Map(leagues.map((l) => [l.ordre, l]));

    // Only weeks that ended AND haven't been closed yet (idempotency).
    const endedWeeks = await prisma.leagueWeek.findMany({
      where: { dateFin: { lte: now }, closedAt: null },
      include: { league: true },
      orderBy: { dateFin: 'asc' },
    });

    let opened = 0;
    for (const week of endedWeeks) {
      opened += await closeWeek(week, byOrdre);
    }
    return { closed: endedWeeks.length, opened };
  });

  if (result == null) return { skipped: true as const, closed: 0, opened: 0 };
  return { skipped: false as const, ...result };
}

interface WeekWithLeague {
  id: string;
  leagueId: string;
  numeroSemaine: number;
  dateDebut: Date;
  dateFin: Date;
  closedAt: Date | null;
  league: { id: string; ordre: number; nom: string };
}

type TxClient = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

/** Idempotently fetch-or-create the next week of a league. */
async function nextWeekOf(
  tx: TxClient,
  leagueId: string,
  numero: number,
  start: Date,
) {
  return tx.leagueWeek.upsert({
    where: { leagueId_numeroSemaine: { leagueId, numeroSemaine: numero } },
    create: {
      leagueId,
      numeroSemaine: numero,
      dateDebut: start,
      dateFin: new Date(start.getTime() + WEEK_MS),
    },
    update: {},
  });
}

/** Close one week: promote/relegate its members, then mark it closed. */
async function closeWeek(
  week: WeekWithLeague,
  byOrdre: Map<number, { id: string; ordre: number }>,
): Promise<number> {
  const tier = week.league.ordre;
  const higher = byOrdre.get(tier + 1)?.id ?? week.leagueId; // already top
  const lower = byOrdre.get(tier - 1)?.id ?? week.leagueId; // already bottom
  const nextNumero = week.numeroSemaine + 1;

  return prisma.$transaction(async (tx) => {
    // Re-check inside the tx that the week is still open (belt & braces).
    const fresh = await tx.leagueWeek.findUnique({ where: { id: week.id } });
    if (!fresh || fresh.closedAt) return 0;

    const total = await tx.leagueMembership.count({ where: { leagueWeekId: week.id } });

    // Process members ranked, in batches.
    let processed = 0;
    while (processed < total) {
      const batch = await tx.leagueMembership.findMany({
        where: { leagueWeekId: week.id },
        orderBy: [{ weeklyXp: 'desc' }, { joinedAt: 'asc' }],
        skip: processed,
        take: BATCH,
        select: { userId: true, weeklyXp: true },
      });
      if (batch.length === 0) break;

      for (let i = 0; i < batch.length; i++) {
        const rank = processed + i + 1; // 1-based
        let targetLeagueId = week.leagueId;
        if (rank <= PROMOTION) targetLeagueId = higher;
        else if (total > RELEGATION && rank > total - RELEGATION) targetLeagueId = lower;

        const targetWeek =
          targetLeagueId === week.leagueId
            ? await nextWeekOf(tx, week.leagueId, nextNumero, week.dateFin)
            : await nextWeekOf(tx, targetLeagueId, nextNumero, week.dateFin);

        await tx.leagueMembership.upsert({
          where: { userId_leagueWeekId: { userId: batch[i]!.userId, leagueWeekId: targetWeek.id } },
          create: { userId: batch[i]!.userId, leagueWeekId: targetWeek.id, weeklyXp: 0 },
          update: { weeklyXp: 0 },
        });
        await tx.user.update({ where: { id: batch[i]!.userId }, data: { weeklyXp: 0 } });

        // Top-3 finish → record a claimable podium reward (idempotent per week).
        if (rank <= 3) {
          await tx.podiumReward.upsert({
            where: { userId_ref: { userId: batch[i]!.userId, ref: `w${week.numeroSemaine}` } },
            create: {
              userId: batch[i]!.userId,
              ref: `w${week.numeroSemaine}`,
              semaine: week.numeroSemaine,
              ligue: week.league.nom,
              rang: rank,
              xp: batch[i]!.weeklyXp,
              reward: PODIUM_XP[rank as 1 | 2 | 3],
            },
            update: {},
          });
        }
      }
      processed += batch.length;
    }

    await tx.leagueWeek.update({ where: { id: week.id }, data: { closedAt: new Date() } });
    return 1;
  });
}

// Allow running directly.
if (import.meta.url === `file://${process.argv[1]}`) {
  runWeeklyRollover()
    .then((r) => {
      // eslint-disable-next-line no-console
      console.log('League rollover:', r);
      return prisma.$disconnect();
    })
    .catch((e) => {
      // eslint-disable-next-line no-console
      console.error(e);
      process.exit(1);
    });
}

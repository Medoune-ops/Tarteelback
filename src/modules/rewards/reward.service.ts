import { prisma } from '../../config/prisma.js';
import { AppError } from '../../core/errors.js';
import { isPremiumActive, applyXpMultiplier } from '../../core/premium.js';
import { localDayKey } from '../../core/streak.js';
import { MAX_HEARTS, computeHearts } from '../../core/hearts.js';
import { leagueService } from '../leagues/league.service.js';
import {
  streakReward,
  podiumReward,
  rollDailyChest,
  CHEST_GEMS_PER_HEART,
  type DailyChestReward,
} from '../../core/rewards.js';

export const rewardService = {
  /** Set/replace the user's streak goal. */
  async setStreakGoal(userId: string, days: number) {
    const user = await prisma.user.update({ where: { id: userId }, data: { streakGoal: days } });
    return { streakGoal: user.streakGoal };
  },

  /**
   * Claim the streak-goal reward IF reached. Server checks `streak >= streakGoal`,
   * credits XP (×2 premium) and clears the goal — all atomically. Idempotent:
   * once cleared, a second call yields xpGained 0.
   */
  async claimStreakReward(userId: string) {
    const result = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${userId} FOR UPDATE`;
      const user = await tx.user.findUniqueOrThrow({ where: { id: userId } });
      if (user.streakGoal == null || user.streak < user.streakGoal) {
        throw new AppError('CONFLICT', 'Streak goal not reached yet');
      }
      const base = streakReward(user.streakGoal);
      const gained = applyXpMultiplier(base, isPremiumActive(user));
      const updated = await tx.user.update({
        where: { id: userId },
        data: { weeklyXp: { increment: gained }, streakGoal: null },
      });
      const league = await leagueService.addXpIfMemberTx(tx, userId, gained);
      return { xpGained: gained, totalXp: updated.weeklyXp, streakGoal: null, league };
    });
    if (result.league) {
      await leagueService.mirrorRankXp(result.league.weekId, userId, result.league.amount);
    }
    return { xpGained: result.xpGained, totalXp: result.totalXp, streakGoal: result.streakGoal };
  },

  /** Podium history (most recent first). */
  async listPodiums(userId: string) {
    const rows = await prisma.podiumReward.findMany({
      where: { userId },
      orderBy: { semaine: 'desc' },
    });
    return rows.map((p) => ({
      id: p.ref,
      semaine: p.semaine,
      ligue: p.ligue,
      rang: p.rang,
      xp: p.xp,
      reward: p.reward,
      claimed: p.claimedAt != null,
    }));
  },

  /**
   * Claim a podium reward once. The reward amount is read from the stored row
   * (server-authoritative), not from the client. Concurrent/duplicate claims
   * are rejected by the conditional update.
   */
  async claimPodium(userId: string, ref: string) {
    const result = await prisma.$transaction(async (tx) => {
      const podium = await tx.podiumReward.findUnique({
        where: { userId_ref: { userId, ref } },
      });
      if (!podium) throw new AppError('NOT_FOUND', 'Podium not found');
      if (podium.claimedAt) throw new AppError('CONFLICT', 'Podium reward already claimed');

      await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${userId} FOR UPDATE`;
      const user = await tx.user.findUniqueOrThrow({ where: { id: userId } });
      // Reward derives from the stored rank (defends against tampered amounts).
      const base = podium.reward || podiumReward(podium.rang);
      const gained = applyXpMultiplier(base, isPremiumActive(user));

      // Atomic single-claim: only succeeds if still unclaimed.
      const marked = await tx.podiumReward.updateMany({
        where: { id: podium.id, claimedAt: null },
        data: { claimedAt: new Date() },
      });
      if (marked.count === 0) throw new AppError('CONFLICT', 'Podium reward already claimed');

      const updated = await tx.user.update({
        where: { id: userId },
        data: { weeklyXp: { increment: gained } },
      });
      const league = await leagueService.addXpIfMemberTx(tx, userId, gained);
      return { xpGained: gained, totalXp: updated.weeklyXp, ref, league };
    });
    if (result.league) {
      await leagueService.mirrorRankXp(result.league.weekId, userId, result.league.amount);
    }
    return { xpGained: result.xpGained, totalXp: result.totalXp, ref: result.ref };
  },

  /** Whether the daily chest is available today (user's local day). */
  async dailyChestStatus(userId: string) {
    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    const today = localDayKey(new Date(), user.timezone);
    return { available: user.lastChestDay !== today };
  },

  /**
   * Open the daily chest once per local day. The reward is rolled SERVER-side
   * (XP or hearts) and applied atomically. A second call the same local day is
   * rejected.
   */
  async claimDailyChest(userId: string): Promise<{ reward: DailyChestReward; totalXp: number; hearts: number; gems: number }> {
    const now = new Date();
    const result = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${userId} FOR UPDATE`;
      const user = await tx.user.findUniqueOrThrow({ where: { id: userId } });
      const today = localDayKey(now, user.timezone);
      if (user.lastChestDay === today) {
        throw new AppError('CONFLICT', 'Daily chest already claimed today');
      }

      const premium = isPremiumActive(user, now);
      let reward = rollDailyChest();

      // Settle time-based regen BEFORE judging "full": hearts rolled while
      // already full (or premium = unlimited) would be worthless, so they are
      // converted to gems instead — the chest never feels like a dud.
      const synced = computeHearts(
        { hearts: user.hearts, lastHeartLossAt: user.lastHeartLossAt },
        premium,
        now,
      );
      if (reward.type === 'hearts' && (premium || synced.hearts >= MAX_HEARTS)) {
        reward = { type: 'gems', amount: reward.amount * CHEST_GEMS_PER_HEART };
      }

      // Reward XP credits the single weekly counter, same as any other XP gain
      // — it also counts towards the league ranking (see league below).
      const data: Record<string, unknown> = {
        lastChestDay: today,
        hearts: synced.hearts,
        lastHeartLossAt: synced.lastHeartLossAt,
      };
      let xpGained = 0;
      if (reward.type === 'xp') {
        xpGained = applyXpMultiplier(reward.amount, premium);
        data.weeklyXp = { increment: xpGained };
      } else if (reward.type === 'gems') {
        data.gems = { increment: reward.amount };
        await tx.gemTransaction.create({
          data: { userId, amount: reward.amount, reason: 'daily_chest', ref: today },
        });
      } else {
        // Hearts capped at MAX.
        data.hearts = Math.min(MAX_HEARTS, synced.hearts + reward.amount);
        if (data.hearts === MAX_HEARTS) data.lastHeartLossAt = null;
      }
      const updated = await tx.user.update({ where: { id: userId }, data });
      const league = xpGained > 0 ? await leagueService.addXpIfMemberTx(tx, userId, xpGained) : null;
      return { reward, totalXp: updated.weeklyXp, hearts: updated.hearts, gems: updated.gems, league };
    });
    if (result.league) {
      await leagueService.mirrorRankXp(result.league.weekId, userId, result.league.amount);
    }
    return { reward: result.reward, totalXp: result.totalXp, hearts: result.hearts, gems: result.gems };
  },
};

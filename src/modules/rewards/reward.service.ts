import { prisma } from '../../config/prisma.js';
import { AppError } from '../../core/errors.js';
import { isPremiumActive, applyXpMultiplier } from '../../core/premium.js';
import { localDayKey } from '../../core/streak.js';
import { MAX_HEARTS } from '../../core/hearts.js';
import { streakReward, podiumReward, rollDailyChest, type DailyChestReward } from '../../core/rewards.js';

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
    return prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${userId} FOR UPDATE`;
      const user = await tx.user.findUniqueOrThrow({ where: { id: userId } });
      if (user.streakGoal == null || user.streak < user.streakGoal) {
        throw new AppError('CONFLICT', 'Streak goal not reached yet');
      }
      const base = streakReward(user.streakGoal);
      const gained = applyXpMultiplier(base, isPremiumActive(user));
      const updated = await tx.user.update({
        where: { id: userId },
        data: { xp: { increment: gained }, streakGoal: null },
      });
      return { xpGained: gained, totalXp: updated.xp, streakGoal: null };
    });
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
    return prisma.$transaction(async (tx) => {
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
        data: { xp: { increment: gained } },
      });
      return { xpGained: gained, totalXp: updated.xp, ref };
    });
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
  async claimDailyChest(userId: string): Promise<{ reward: DailyChestReward; totalXp: number; hearts: number }> {
    const now = new Date();
    return prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${userId} FOR UPDATE`;
      const user = await tx.user.findUniqueOrThrow({ where: { id: userId } });
      const today = localDayKey(now, user.timezone);
      if (user.lastChestDay === today) {
        throw new AppError('CONFLICT', 'Daily chest already claimed today');
      }

      const premium = isPremiumActive(user, now);
      const reward = rollDailyChest();

      // Reward XP credits total XP only (like the front's addXP) — it is not
      // weekly/league XP, so the league ranking is untouched.
      const data: Record<string, unknown> = { lastChestDay: today };
      if (reward.type === 'xp') {
        data.xp = { increment: applyXpMultiplier(reward.amount, premium) };
      } else {
        // Hearts capped at MAX.
        data.hearts = Math.min(MAX_HEARTS, user.hearts + reward.amount);
        if (data.hearts === MAX_HEARTS) data.lastHeartLossAt = null;
      }
      const updated = await tx.user.update({ where: { id: userId }, data });
      return { reward, totalXp: updated.xp, hearts: updated.hearts };
    });
  },
};

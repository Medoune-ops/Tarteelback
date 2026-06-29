/**
 * Reward barèmes — server-authoritative mirror of the front `constants/rewards.ts`.
 * Single source of truth so the client can never self-award XP/hearts.
 *
 *   - streakReward(days): XP for reaching a streak goal (non-linear).
 *   - PODIUM_REWARD: XP for a weekly top-3 finish.
 *   - rollDailyChest(): random daily-chest reward (XP or hearts).
 */

const STREAK_REWARD_TABLE: { days: number; xp: number }[] = [
  { days: 7, xp: 100 },
  { days: 14, xp: 250 },
  { days: 30, xp: 600 },
  { days: 50, xp: 1200 },
  { days: 100, xp: 2500 },
  { days: 365, xp: 10000 },
];

/** XP awarded for a reached streak goal (interpolated between known tiers). */
export function streakReward(days: number): number {
  if (days <= 0) return 0;
  const table = STREAK_REWARD_TABLE;
  if (days <= table[0]!.days) return Math.round((days / table[0]!.days) * table[0]!.xp);
  for (let i = 1; i < table.length; i++) {
    if (days <= table[i]!.days) {
      const a = table[i - 1]!;
      const b = table[i]!;
      const t = (days - a.days) / (b.days - a.days);
      return Math.round(a.xp + t * (b.xp - a.xp));
    }
  }
  const last = table[table.length - 1]!;
  return Math.round(last.xp + (days - last.days) * 30);
}

export const PODIUM_REWARD: Record<1 | 2 | 3, number> = { 1: 500, 2: 300, 3: 150 };

export function podiumReward(rang: number): number {
  return PODIUM_REWARD[rang as 1 | 2 | 3] ?? 0;
}

export type DailyChestReward =
  | { type: 'xp'; amount: number }
  | { type: 'hearts'; amount: number };

const DAILY_CHEST_POOL: DailyChestReward[] = [
  { type: 'xp', amount: 10 },
  { type: 'xp', amount: 20 },
  { type: 'xp', amount: 30 },
  { type: 'xp', amount: 50 },
  { type: 'hearts', amount: 1 },
  { type: 'hearts', amount: 2 },
];

/** Random daily-chest reward. `rng` is injectable for deterministic tests. */
export function rollDailyChest(rng: () => number = Math.random): DailyChestReward {
  return DAILY_CHEST_POOL[Math.floor(rng() * DAILY_CHEST_POOL.length)]!;
}

export const MAX_STREAK_GOAL = 9999;

/**
 * Gem economy barèmes — server-authoritative, single source of truth (the
 * front mirrors these constants; the client can never self-award gems).
 *
 * Sources (earn):  lesson +10 (perfect +20), daily streak +5 (+50 D7, +150
 * D30), league promotion +100..500, paid packs.
 * Sinks (spend):   heart refill 350, streak freeze 200, double-XP 15min 100.
 *
 * Calibration target: an active free player earns ~60-80 gems/day, so a heart
 * refill ≈ 5 days of saving. Economy health KPI: earned:spent ≈ 1.2:1
 * (computable from the GemTransaction ledger).
 */

// ─── Earnings ────────────────────────────────────────────────────────────────

/** Completed lesson (first completion only — same anti-farm rule as XP). */
export const GEM_LESSON_COMPLETE = 10;
/** Perfect lesson (0 mistakes) — replaces (not stacks with) the +10. */
export const GEM_LESSON_PERFECT = 20;
/** Daily streak maintained (+1 day). */
export const GEM_DAILY_STREAK = 5;
/** One-shot streak milestones (credited the day the streak reaches it). */
export const GEM_STREAK_MILESTONES: Record<number, number> = { 7: 50, 30: 150 };

/**
 * Gems for a league promotion, by the REACHED tier's `ordre` (1 = lowest).
 * Spec: +100 to +500 depending on rank. With 5 tiers: reaching tier 2 → 100 …
 * tier 5 → 400, capped at 500 if more tiers are ever added.
 */
export function promotionGems(reachedOrdre: number): number {
  return Math.max(100, Math.min(500, (reachedOrdre - 1) * 100));
}

// ─── Spends ──────────────────────────────────────────────────────────────────

/** Instant refill to MAX_HEARTS. */
export const GEM_COST_HEART_REFILL = 350;
/** One streak-freeze item (protects 1 missed day). */
export const GEM_COST_STREAK_FREEZE = 200;
/** Double XP for 15 minutes. */
export const GEM_COST_DOUBLE_XP = 100;
export const DOUBLE_XP_DURATION_MS = 15 * 60 * 1000;
export const DOUBLE_XP_MULTIPLIER = 2;

/** Max streak-freeze items a free user can hold (Plus = unlimited, none held). */
export const MAX_STREAK_FREEZES = 2;

// ─── "Réviser pour regagner" gate (hearts = 0, exit #1) ─────────────────────

/** Max hearts regainable through completed review sessions per local day. */
export const REVIEW_HEARTS_PER_DAY = 2;

// ─── Paid packs (mock provider; regionalize via RevenueCat later) ───────────

export interface GemPack {
  id: 'p500' | 'p3000' | 'p7000';
  gems: number;
  priceEur: number;
  /** Marketing tag mirrored by the front ("populaire", "+15% bonus"). */
  tag?: string;
}

export const GEM_PACKS: Record<GemPack['id'], GemPack> = {
  p500: { id: 'p500', gems: 500, priceEur: 0.99 },
  p3000: { id: 'p3000', gems: 3000, priceEur: 4, tag: 'populaire' },
  p7000: { id: 'p7000', gems: 7000, priceEur: 7, tag: '+15% bonus' },
};

/** True while a bought double-XP boost is running. */
export function isDoubleXpActive(doubleXpUntil: Date | null, now: Date = new Date()): boolean {
  return doubleXpUntil != null && doubleXpUntil.getTime() > now.getTime();
}

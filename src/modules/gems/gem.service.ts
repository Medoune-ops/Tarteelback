import { prisma } from '../../config/prisma.js';
import { AppError } from '../../core/errors.js';
import { isPremiumActive } from '../../core/premium.js';
import { computeHearts, snapshot, MAX_HEARTS } from '../../core/hearts.js';
import { localDayKey } from '../../core/streak.js';
import {
  GEM_COST_HEART_REFILL,
  GEM_COST_STREAK_FREEZE,
  GEM_COST_DOUBLE_XP,
  DOUBLE_XP_DURATION_MS,
  MAX_STREAK_FREEZES,
  REVIEW_HEARTS_PER_DAY,
  REVIEW_SESSION_MAX_AGE_MS,
  isDoubleXpActive,
} from '../../core/gems.js';

/**
 * Gem economy sinks + the free "réviser pour regagner" heart gate. Every spend
 * is atomic: the user row is locked, the balance is checked and decremented in
 * the same transaction as the ledger row (no double-spend race).
 */
async function spendGems(
  tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0],
  userId: string,
  cost: number,
  reason: 'heart_refill' | 'streak_freeze' | 'double_xp',
  ref?: string,
) {
  // Conditional decrement = atomic "has enough" check (no read-modify-write).
  const res = await tx.user.updateMany({
    where: { id: userId, gems: { gte: cost } },
    data: { gems: { decrement: cost } },
  });
  if (res.count === 0) {
    throw new AppError('INSUFFICIENT_GEMS', `This costs ${cost} gems`);
  }
  await tx.gemTransaction.create({
    data: { userId, amount: -cost, reason, ref },
  });
}

export const gemService = {
  /** GET /me/gems — balance + recent ledger entries. */
  async status(userId: string) {
    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    const transactions = await prisma.gemTransaction.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });
    return {
      gems: user.gems,
      streakFreezes: user.streakFreezes,
      doubleXpUntil: user.doubleXpUntil,
      doubleXpActive: isDoubleXpActive(user.doubleXpUntil),
      transactions: transactions.map((t) => ({
        id: t.id,
        amount: t.amount,
        reason: t.reason,
        ref: t.ref,
        createdAt: t.createdAt,
      })),
    };
  },

  /** POST /me/hearts/refill — 5 hearts instantly for 350 gems. */
  async refillHearts(userId: string) {
    const now = new Date();
    return prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${userId} FOR UPDATE`;
      const user = await tx.user.findUniqueOrThrow({ where: { id: userId } });
      const premium = isPremiumActive(user, now);
      if (premium) throw new AppError('CONFLICT', 'Hearts are unlimited with Plus');

      // Settle time-based regen first: never sell hearts the user already has.
      const synced = computeHearts(
        { hearts: user.hearts, lastHeartLossAt: user.lastHeartLossAt },
        premium,
        now,
      );
      if (synced.hearts >= MAX_HEARTS) {
        throw new AppError('CONFLICT', 'Hearts are already full');
      }

      await spendGems(tx, userId, GEM_COST_HEART_REFILL, 'heart_refill');
      const updated = await tx.user.update({
        where: { id: userId },
        data: { hearts: MAX_HEARTS, lastHeartLossAt: null },
      });
      const snap = snapshot(
        { hearts: updated.hearts, lastHeartLossAt: updated.lastHeartLossAt },
        premium,
        now,
      );
      return { gems: updated.gems, hearts: snap.hearts, msUntilNextHeart: snap.msUntilNextHeart };
    });
  },

  /**
   * POST /me/hearts/review-regain — "réviser pour regagner": one COMPLETED
   * review session = +1 heart, free, max 2 per local day.
   *
   * Validated against the real review module: `numero` must reference a
   * `SourateRevision` whose `derniereRevision` is very recent, i.e. the
   * client just finished a real POST /me/revisions/:id/review for it — no
   * more taking the client's word for it. `derniereRecompenseCoeur` marks
   * which completion was already cashed in, so the SAME session can't be
   * replayed for a second heart within the 10-minute window (only a fresh
   * `derniereRevision` — i.e. a new POST .../review — unlocks another).
   */
  async reviewRegainHeart(userId: string, numero: number) {
    const now = new Date();

    const sourate = await prisma.sourate.findUnique({ where: { numero } });
    if (!sourate) throw new AppError('NOT_FOUND', 'Sourate not found');
    const revision = await prisma.sourateRevision.findUnique({
      where: { userId_sourateId: { userId, sourateId: sourate.id } },
    });
    const derniereRevision = revision?.derniereRevision;
    if (!derniereRevision || now.getTime() - derniereRevision.getTime() > REVIEW_SESSION_MAX_AGE_MS) {
      throw new AppError('CONFLICT', 'No recently completed review session found for this sourate');
    }
    if (
      revision.derniereRecompenseCoeur &&
      revision.derniereRecompenseCoeur.getTime() >= derniereRevision.getTime()
    ) {
      throw new AppError('CONFLICT', 'This review session already granted a heart');
    }

    return prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${userId} FOR UPDATE`;

      // Atomic "not already claimed" check + claim, mirroring spendGems's
      // conditional-update pattern — closes the race where two concurrent
      // requests both pass the pre-check above for the same session.
      const claim = await tx.sourateRevision.updateMany({
        where: {
          userId,
          sourateId: sourate.id,
          derniereRevision,
          OR: [
            { derniereRecompenseCoeur: null },
            { derniereRecompenseCoeur: { lt: derniereRevision } },
          ],
        },
        data: { derniereRecompenseCoeur: derniereRevision },
      });
      if (claim.count === 0) {
        throw new AppError('CONFLICT', 'This review session already granted a heart');
      }

      const user = await tx.user.findUniqueOrThrow({ where: { id: userId } });
      const premium = isPremiumActive(user, now);
      if (premium) throw new AppError('CONFLICT', 'Hearts are unlimited with Plus');

      const synced = computeHearts(
        { hearts: user.hearts, lastHeartLossAt: user.lastHeartLossAt },
        premium,
        now,
      );
      if (synced.hearts >= MAX_HEARTS) {
        throw new AppError('CONFLICT', 'Hearts are already full');
      }

      const today = localDayKey(now, user.timezone);
      const usedToday = user.reviewHeartsDay === today ? user.reviewHeartsUsed : 0;
      if (usedToday >= REVIEW_HEARTS_PER_DAY) {
        throw new AppError('CONFLICT', 'Review heart limit reached for today');
      }

      const newHearts = Math.min(MAX_HEARTS, synced.hearts + 1);
      const updated = await tx.user.update({
        where: { id: userId },
        data: {
          hearts: newHearts,
          lastHeartLossAt: newHearts >= MAX_HEARTS ? null : synced.lastHeartLossAt,
          reviewHeartsDay: today,
          reviewHeartsUsed: usedToday + 1,
        },
      });
      const snap = snapshot(
        { hearts: updated.hearts, lastHeartLossAt: updated.lastHeartLossAt },
        premium,
        now,
      );
      return {
        hearts: snap.hearts,
        msUntilNextHeart: snap.msUntilNextHeart,
        reviewHeartsRemaining: REVIEW_HEARTS_PER_DAY - (usedToday + 1),
      };
    });
  },

  /** POST /me/streak-freezes — buy one freeze (200 gems), max 2 held. */
  async buyStreakFreeze(userId: string) {
    return prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${userId} FOR UPDATE`;
      const user = await tx.user.findUniqueOrThrow({ where: { id: userId } });
      if (isPremiumActive(user)) {
        throw new AppError('CONFLICT', 'Streak freezes are unlimited with Plus');
      }
      if (user.streakFreezes >= MAX_STREAK_FREEZES) {
        throw new AppError('CONFLICT', `You already hold ${MAX_STREAK_FREEZES} streak freezes`);
      }
      await spendGems(tx, userId, GEM_COST_STREAK_FREEZE, 'streak_freeze');
      const updated = await tx.user.update({
        where: { id: userId },
        data: { streakFreezes: { increment: 1 } },
      });
      return { gems: updated.gems, streakFreezes: updated.streakFreezes };
    });
  },

  /** POST /me/boosts/double-xp — double XP for 15 minutes (100 gems). */
  async buyDoubleXp(userId: string) {
    const now = new Date();
    return prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${userId} FOR UPDATE`;
      const user = await tx.user.findUniqueOrThrow({ where: { id: userId } });
      if (isDoubleXpActive(user.doubleXpUntil, now)) {
        throw new AppError('CONFLICT', 'A double-XP boost is already running');
      }
      await spendGems(tx, userId, GEM_COST_DOUBLE_XP, 'double_xp');
      const doubleXpUntil = new Date(now.getTime() + DOUBLE_XP_DURATION_MS);
      const updated = await tx.user.update({
        where: { id: userId },
        data: { doubleXpUntil },
      });
      return { gems: updated.gems, doubleXpUntil: updated.doubleXpUntil };
    });
  },
};

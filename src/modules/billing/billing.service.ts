import crypto from 'node:crypto';
import { prisma } from '../../config/prisma.js';
import { env } from '../../config/env.js';
import { AppError } from '../../core/errors.js';
import { isPremiumActive } from '../../core/premium.js';
import { repairStreak } from '../../core/streak.js';
import { userRepository } from '../me/user.repository.js';
import { GEM_PACKS } from '../../core/gems.js';
import type { SubscribeInput, BuyGemsInput } from './billing.schemas.js';

/**
 * MOCK billing provider. No real Stripe call: we record a Transaction and apply
 * the entitlement. The API contract is identical to a real provider, so a
 * Stripe integration can replace `charge()` without touching callers.
 */
function charge(amount: number): { ok: boolean; ref: string } {
  // Always succeeds in mock mode; ref mimics a provider charge id.
  return { ok: true, ref: `mock_${crypto.randomBytes(8).toString('hex')}` };
}

export const billingService = {
  /** POST /billing/subscribe — activate premium for 1 month / 1 year. */
  async subscribe(userId: string, input: SubscribeInput) {
    const now = new Date();
    const user = await userRepository.getOrThrow(userId);

    const isYearly = input.plan === 'annuel';
    const amount = isYearly ? env.PREMIUM_PRICE_YEARLY : env.PREMIUM_PRICE_MONTHLY;

    const result = charge(amount);
    if (!result.ok) {
      await prisma.transaction.create({
        data: {
          userId,
          type: 'premium_subscription',
          montant: amount,
          devise: env.BILLING_CURRENCY,
          statut: 'failed',
        },
      });
      throw new AppError('PAYMENT_FAILED', 'Payment was declined');
    }

    // Extend from the later of now / current premiumUntil.
    const base =
      user.premiumUntil && user.premiumUntil > now ? user.premiumUntil : now;
    const premiumUntil = new Date(base);
    if (isYearly) premiumUntil.setFullYear(premiumUntil.getFullYear() + 1);
    else premiumUntil.setMonth(premiumUntil.getMonth() + 1);

    const [updated] = await prisma.$transaction([
      prisma.user.update({
        where: { id: userId },
        data: { isPremium: true, premiumUntil, hearts: env.MAX_HEARTS, lastHeartLossAt: null },
      }),
      prisma.transaction.create({
        data: {
          userId,
          type: 'premium_subscription',
          montant: amount,
          devise: env.BILLING_CURRENCY,
          statut: 'success',
          providerRef: result.ref,
        },
      }),
    ]);

    return {
      isPremium: true,
      premiumUntil: updated.premiumUntil,
      plan: input.plan,
      providerRef: result.ref,
    };
  },

  /** GET /billing/status. */
  async status(userId: string) {
    const user = await userRepository.getOrThrow(userId);
    const premium = isPremiumActive(user);
    const transactions = await prisma.transaction.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });
    return {
      isPremium: premium,
      premiumUntil: user.premiumUntil,
      transactions,
    };
  },

  /**
   * POST /billing/gems — buy a gem pack (mock payment, later RevenueCat).
   * Money Transaction + gem credit + ledger row are committed atomically.
   */
  async buyGems(userId: string, input: BuyGemsInput) {
    const pack = GEM_PACKS[input.pack];
    await userRepository.getOrThrow(userId);

    const result = charge(pack.priceEur);
    if (!result.ok) throw new AppError('PAYMENT_FAILED', 'Payment was declined');

    const [updated] = await prisma.$transaction([
      prisma.user.update({
        where: { id: userId },
        data: { gems: { increment: pack.gems } },
      }),
      prisma.transaction.create({
        data: {
          userId,
          type: 'gem_pack',
          montant: pack.priceEur,
          devise: env.BILLING_CURRENCY,
          statut: 'success',
          providerRef: result.ref,
        },
      }),
      prisma.gemTransaction.create({
        data: { userId, amount: pack.gems, reason: 'pack_purchase', ref: result.ref },
      }),
    ]);

    return { gems: updated.gems, pack: pack.id, gemsAdded: pack.gems, providerRef: result.ref };
  },

  /** POST /billing/repair-streak — pay to restore the broken streak. */
  async repairStreak(userId: string) {
    const user = await userRepository.getOrThrow(userId);
    if (user.lastStreakValue <= 0) {
      throw new AppError('NO_STREAK_TO_REPAIR', 'There is no streak to repair');
    }

    const amount = env.STREAK_REPAIR_PRICE;
    const result = charge(amount);
    if (!result.ok) throw new AppError('PAYMENT_FAILED', 'Payment was declined');

    const now = new Date();
    const restored = repairStreak(
      {
        streak: user.streak,
        streakFrozen: user.streakFrozen,
        lastStreakValue: user.lastStreakValue,
        lastActivityDate: user.lastActivityDate,
      },
      now,
    );

    const [updated] = await prisma.$transaction([
      prisma.user.update({
        where: { id: userId },
        // Persist lastActivityDate too so the restored streak isn't re-broken.
        data: {
          streak: restored.streak,
          streakFrozen: false,
          lastActivityDate: restored.lastActivityDate,
        },
      }),
      prisma.transaction.create({
        data: {
          userId,
          type: 'streak_repair',
          montant: amount,
          devise: env.BILLING_CURRENCY,
          statut: 'success',
          providerRef: result.ref,
        },
      }),
    ]);

    return { streak: updated.streak, providerRef: result.ref };
  },
};

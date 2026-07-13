import crypto from 'node:crypto';
import { prisma } from '../../config/prisma.js';
import { env } from '../../config/env.js';
import { AppError } from '../../core/errors.js';
import { isPremiumActive } from '../../core/premium.js';
import { repairStreak } from '../../core/streak.js';
import { userRepository } from '../me/user.repository.js';
import { GEM_PACKS } from '../../core/gems.js';
import { MAX_HEARTS } from '../../core/hearts.js';
import { isFamilyPlan, recomputePremium } from '../../core/household.js';
import { householdService } from '../household/household.service.js';
import type { SubscribeInput, BuyGemsInput, BuyHeartsInput } from './billing.schemas.js';

/**
 * ══════════ POINT DE BRANCHEMENT DE L'API DE PAIEMENT (côté serveur) ══════════
 *
 * MOCK billing provider — dev uniquement, aucun débit réel. Le contrat API est
 * identique à un vrai provider : au branchement (Stripe/RevenueCat/Wave…),
 * remplacer UNIQUEMENT `charge()` par la vérification du `paymentToken` reçu
 * du client (créé par le PaymentProvider du front, lib/payments.ts) — les
 * appelants (subscribe, buyGems, repairStreak) ne changent pas.
 *
 * ⚠ Tant que ce mock est en place, `charge()` accepte tout : NE PAS lancer
 * commercialement sans l'avoir remplacé (Premium gratuit sinon).
 */
function charge(amount: number, paymentToken?: string): { ok: boolean; ref: string } {
  // Mock : réussit toujours ; `ref` imite un id de charge provider. Le vrai
  // provider devra vérifier `paymentToken` + le montant, et renvoyer sa ref.
  void paymentToken;
  return { ok: true, ref: `mock_${crypto.randomBytes(8).toString('hex')}` };
}

export const billingService = {
  /**
   * POST /billing/subscribe — active un abonnement premium (1 mois / 1 an),
   * individuel OU familial. Familial : active l'abonnement du FOYER (créé si
   * besoin) → tous les membres deviennent premium. Individuel : prolonge le
   * premium PERSONNEL puis recalcule le premium effectif.
   */
  async subscribe(userId: string, input: SubscribeInput) {
    const now = new Date();
    const user = await userRepository.getOrThrow(userId);

    const family = isFamilyPlan(input.plan);
    const isYearly = input.plan === 'annuel' || input.plan === 'famille_annuel';
    const amount = family
      ? isYearly
        ? env.PREMIUM_PRICE_FAMILY_YEARLY
        : env.PREMIUM_PRICE_FAMILY_MONTHLY
      : isYearly
        ? env.PREMIUM_PRICE_YEARLY
        : env.PREMIUM_PRICE_MONTHLY;

    const result = charge(amount, input.paymentToken);
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

    let premiumUntil: Date;
    if (family) {
      // Active/étend l'abonnement du foyer → recalcule tous les membres.
      premiumUntil = await householdService.activateSubscription(userId, input.plan, isYearly, now);
    } else {
      // Prolonge le premium PERSONNEL depuis la date la plus tardive.
      const base =
        user.personalPremiumUntil && user.personalPremiumUntil > now
          ? user.personalPremiumUntil
          : now;
      premiumUntil = new Date(base);
      if (isYearly) premiumUntil.setFullYear(premiumUntil.getFullYear() + 1);
      else premiumUntil.setMonth(premiumUntil.getMonth() + 1);
      await prisma.user.update({
        where: { id: userId },
        data: { personalPremiumUntil: premiumUntil },
      });
      await recomputePremium(userId, now);
    }

    // Cœurs pleins pour l'abonné qui paie + trace de la transaction.
    await prisma.$transaction([
      prisma.user.update({
        where: { id: userId },
        data: { hearts: MAX_HEARTS, lastHeartLossAt: null },
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
      premiumUntil,
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

  /**
   * POST /billing/hearts — achète un refill complet des cœurs avec de l'argent
   * (paiement mock). Premium = cœurs illimités → l'achat n'a pas de sens et est
   * refusé. Le verrou de ligne (FOR UPDATE) empêche deux requêtes concurrentes
   * de passer toutes les deux le check "pas déjà plein" et de facturer deux
   * refills pour un seul achat. Transaction monétaire + refill sont committés
   * atomiquement.
   */
  async buyHearts(userId: string, input: BuyHeartsInput) {
    return prisma.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM "User" WHERE id = ${userId} FOR UPDATE`;
      if (locked.length === 0) throw new AppError('NOT_FOUND', 'User not found');

      const user = await tx.user.findUniqueOrThrow({ where: { id: userId } });
      if (isPremiumActive(user)) {
        throw new AppError('CONFLICT', 'Hearts are unlimited with Plus');
      }
      if (user.hearts >= MAX_HEARTS) {
        throw new AppError('CONFLICT', 'Hearts are already full');
      }

      const amount = env.HEART_REFILL_PRICE;
      const result = charge(amount, input.paymentToken);
      if (!result.ok) throw new AppError('PAYMENT_FAILED', 'Payment was declined');

      const updated = await tx.user.update({
        where: { id: userId },
        data: { hearts: MAX_HEARTS, lastHeartLossAt: null },
      });
      await tx.transaction.create({
        data: {
          userId,
          type: 'heart_pack',
          montant: amount,
          devise: env.BILLING_CURRENCY,
          statut: 'success',
          providerRef: result.ref,
        },
      });

      return { hearts: updated.hearts, providerRef: result.ref };
    });
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

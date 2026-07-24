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
import { eurToDexpayAmount } from '../../core/dexpayCurrency.js';
import { createCheckoutSession } from './dexpay.client.js';
import type { SubscribeInput, BuyGemsInput, BuyHeartsInput } from './billing.schemas.js';
import type { Prisma, Transaction, TransactionType } from '@prisma/client';

/**
 * ══════════ INTÉGRATION DEXPAY (paiement carte, popup SDK) ══════════
 *
 * Le paiement est ASYNCHRONE : ces méthodes ne créditent RIEN elles-mêmes —
 * elles créent une Transaction `pending` + une checkout session DexPay et
 * renvoient `paymentUrl` au front (qui ouvre le popup SDK Checkout JS,
 * `paymentMethod: 'card'`). L'effet (premium/gemmes/cœurs/streak) n'est
 * appliqué que par `applyPaidTransaction`, appelée depuis le webhook
 * `checkout.completed` (dexpay.webhook.ts) — JAMAIS depuis une réponse HTTP
 * synchrone, ni depuis un callback du popup (voir doc DexPay : "la source de
 * vérité reste le webhook").
 */

/** Génère une référence unique côté marchand pour une nouvelle transaction. */
function newReference(prefix: string): string {
  return `${prefix}_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
}

/** Crée la Transaction pending + la checkout session DexPay associée. */
async function startPayment(
  userId: string,
  type: TransactionType,
  amountEur: number,
  itemName: string,
  payload?: Prisma.InputJsonValue,
): Promise<{ transaction: Transaction; paymentUrl: string }> {
  const reference = newReference(type);
  const transaction = await prisma.transaction.create({
    data: {
      userId,
      type,
      montant: amountEur,
      devise: env.BILLING_CURRENCY,
      statut: 'pending',
      reference,
      payload,
    },
  });

  if (!env.PUBLIC_BASE_URL) {
    throw new AppError('SERVICE_UNAVAILABLE', 'PUBLIC_BASE_URL is not configured');
  }

  const session = await createCheckoutSession({
    reference,
    itemName,
    amount: eurToDexpayAmount(amountEur),
    currency: env.DEXPAY_CURRENCY,
    successUrl: `${env.PUBLIC_BASE_URL}/billing/dexpay/success`,
    failureUrl: `${env.PUBLIC_BASE_URL}/billing/dexpay/failure`,
    webhookUrl: `${env.PUBLIC_BASE_URL}/billing/webhooks/dexpay`,
    metadata: { userId, type },
  });

  return { transaction, paymentUrl: session.payment_url };
}

/**
 * Applique l'effet métier d'une Transaction confirmée par webhook DexPay.
 * Idempotent : si la transaction n'est plus `pending` (déjà traitée par un
 * webhook redelivré), ne fait rien — voir DexPay retry policy (jusqu'à 5
 * tentatives).
 */
export async function applyPaidTransaction(reference: string): Promise<void> {
  const transaction = await prisma.transaction.findUnique({ where: { reference } });
  if (!transaction || transaction.statut !== 'pending') return;

  const now = new Date();
  const payload = (transaction.payload as Record<string, unknown> | null) ?? {};

  switch (transaction.type) {
    case 'premium_subscription': {
      const plan = payload.plan as SubscribeInput['plan'];
      const user = await userRepository.getOrThrow(transaction.userId);
      const family = isFamilyPlan(plan);
      const isYearly = plan === 'annuel' || plan === 'famille_annuel';

      if (family) {
        await householdService.activateSubscription(transaction.userId, plan, isYearly, now);
      } else {
        const base =
          user.personalPremiumUntil && user.personalPremiumUntil > now
            ? user.personalPremiumUntil
            : now;
        const premiumUntil = new Date(base);
        if (isYearly) premiumUntil.setFullYear(premiumUntil.getFullYear() + 1);
        else premiumUntil.setMonth(premiumUntil.getMonth() + 1);
        await prisma.user.update({ where: { id: transaction.userId }, data: { personalPremiumUntil: premiumUntil } });
        await recomputePremium(transaction.userId, now);
      }

      await prisma.$transaction([
        prisma.user.update({
          where: { id: transaction.userId },
          data: { hearts: MAX_HEARTS, lastHeartLossAt: null },
        }),
        prisma.transaction.update({ where: { id: transaction.id }, data: { statut: 'success' } }),
      ]);
      break;
    }

    case 'gem_pack': {
      const packId = payload.pack as keyof typeof GEM_PACKS;
      const pack = GEM_PACKS[packId];
      await prisma.$transaction([
        prisma.user.update({ where: { id: transaction.userId }, data: { gems: { increment: pack.gems } } }),
        prisma.transaction.update({ where: { id: transaction.id }, data: { statut: 'success' } }),
        prisma.gemTransaction.create({
          data: { userId: transaction.userId, amount: pack.gems, reason: 'pack_purchase', ref: reference },
        }),
      ]);
      break;
    }

    case 'heart_pack': {
      await prisma.$transaction([
        prisma.user.update({
          where: { id: transaction.userId },
          data: { hearts: MAX_HEARTS, lastHeartLossAt: null },
        }),
        prisma.transaction.update({ where: { id: transaction.id }, data: { statut: 'success' } }),
      ]);
      break;
    }

    case 'streak_repair': {
      const user = await userRepository.getOrThrow(transaction.userId);
      const restored = repairStreak(
        {
          streak: user.streak,
          streakFrozen: user.streakFrozen,
          lastStreakValue: user.lastStreakValue,
          lastActivityDate: user.lastActivityDate,
        },
        now,
      );
      await prisma.$transaction([
        prisma.user.update({
          where: { id: transaction.userId },
          data: { streak: restored.streak, streakFrozen: false, lastActivityDate: restored.lastActivityDate },
        }),
        prisma.transaction.update({ where: { id: transaction.id }, data: { statut: 'success' } }),
      ]);
      break;
    }
  }
}

/** Marque une Transaction pending comme failed/cancelled (webhook DexPay). */
export async function markTransactionFailed(reference: string): Promise<void> {
  await prisma.transaction.updateMany({
    where: { reference, statut: 'pending' },
    data: { statut: 'failed' },
  });
}

export const billingService = {
  /**
   * POST /billing/subscribe — crée une checkout session DexPay pour activer
   * un abonnement premium (1 mois / 1 an, individuel ou familial). L'effet
   * n'est appliqué qu'à réception du webhook `checkout.completed`.
   */
  async subscribe(userId: string, input: SubscribeInput) {
    await userRepository.getOrThrow(userId);
    const family = isFamilyPlan(input.plan);
    const isYearly = input.plan === 'annuel' || input.plan === 'famille_annuel';
    const amount = family
      ? isYearly
        ? env.PREMIUM_PRICE_FAMILY_YEARLY
        : env.PREMIUM_PRICE_FAMILY_MONTHLY
      : isYearly
        ? env.PREMIUM_PRICE_YEARLY
        : env.PREMIUM_PRICE_MONTHLY;

    const { transaction, paymentUrl } = await startPayment(
      userId,
      'premium_subscription',
      amount,
      'Abonnement Tarteel Plus',
      { plan: input.plan },
    );
    return { reference: transaction.reference, paymentUrl };
  },

  /**
   * POST /billing/cancel — annule l'abonnement PERSONNEL de ce compte (effet
   * immédiat : pas d'auto-renouvellement simulé dans ce mock, donc rien à
   * laisser courir jusqu'à une fin de période). Si le premium effectif de
   * l'utilisateur vient uniquement d'un plan familial (pas d'abonnement
   * personnel actif), il n'y a rien à annuler ici — il doit quitter le foyer
   * (cf. household.service.ts) pour perdre ce premium.
   */
  async cancelSubscription(userId: string) {
    const now = new Date();
    const user = await userRepository.getOrThrow(userId);
    if (!user.personalPremiumUntil || user.personalPremiumUntil.getTime() <= now.getTime()) {
      throw new AppError('NO_PERSONAL_SUBSCRIPTION', 'No personal subscription to cancel');
    }

    await prisma.user.update({
      where: { id: userId },
      data: { personalPremiumUntil: null },
    });
    await recomputePremium(userId, now);

    const updated = await userRepository.getOrThrow(userId);
    return { isPremium: updated.isPremium, premiumUntil: updated.premiumUntil };
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

  /** GET /billing/transactions/:reference — état d'un paiement en cours (polling front après le popup). */
  async getTransaction(userId: string, reference: string) {
    const transaction = await prisma.transaction.findUnique({ where: { reference } });
    if (!transaction || transaction.userId !== userId) {
      throw new AppError('NOT_FOUND', 'Transaction not found');
    }
    return transaction;
  },

  /**
   * POST /billing/gems — crée une checkout session DexPay pour l'achat d'un
   * pack de gemmes. Crédité uniquement à réception du webhook.
   */
  async buyGems(userId: string, input: BuyGemsInput) {
    const pack = GEM_PACKS[input.pack];
    await userRepository.getOrThrow(userId);

    const { transaction, paymentUrl } = await startPayment(
      userId,
      'gem_pack',
      pack.priceEur,
      `${pack.gems} gemmes`,
      { pack: input.pack },
    );
    return { reference: transaction.reference, paymentUrl };
  },

  /**
   * POST /billing/hearts — crée une checkout session DexPay pour un refill
   * complet des cœurs. Premium = cœurs illimités → achat refusé direct.
   */
  async buyHearts(userId: string, _input: BuyHeartsInput) {
    const user = await userRepository.getOrThrow(userId);
    if (isPremiumActive(user)) {
      throw new AppError('CONFLICT', 'Hearts are unlimited with Plus');
    }
    if (user.hearts >= MAX_HEARTS) {
      throw new AppError('CONFLICT', 'Hearts are already full');
    }

    const { transaction, paymentUrl } = await startPayment(
      userId,
      'heart_pack',
      env.HEART_REFILL_PRICE,
      'Recharge complète des cœurs',
    );
    return { reference: transaction.reference, paymentUrl };
  },

  /** POST /billing/repair-streak — crée une checkout session DexPay pour restaurer la streak cassée. */
  async repairStreak(userId: string) {
    const user = await userRepository.getOrThrow(userId);
    if (user.lastStreakValue <= 0) {
      throw new AppError('NO_STREAK_TO_REPAIR', 'There is no streak to repair');
    }

    const { transaction, paymentUrl } = await startPayment(
      userId,
      'streak_repair',
      env.STREAK_REPAIR_PRICE,
      'Réparation de la série',
    );
    return { reference: transaction.reference, paymentUrl };
  },
};

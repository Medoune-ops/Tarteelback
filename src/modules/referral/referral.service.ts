import { Prisma } from '@prisma/client';
import { prisma } from '../../config/prisma.js';
import { AppError } from '../../core/errors.js';
import { isPremiumActive } from '../../core/premium.js';
import { computeHearts, MAX_HEARTS } from '../../core/hearts.js';
import {
  REFERRAL_HEART_REWARD,
  REFERRAL_MAX_REWARDED_REFERRALS,
  generateReferralCode,
  normalizeReferralCode,
} from '../../core/referral.js';
import { userRepository } from '../me/user.repository.js';
import { computeUserStats } from '../me/user.stats.js';
import { serializeUserFlat } from '../me/user.serializer.js';

type Tx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

/**
 * Crédite `reward` cœurs à un utilisateur DANS la transaction, en respectant
 * l'ancre de régénération (settle d'abord, plafonne à MAX, remet l'ancre à null
 * si plein). Premium = cœurs illimités → rien à créditer.
 */
async function grantHearts(tx: Tx, userId: string, reward: number, now: Date) {
  const user = await tx.user.findUniqueOrThrow({ where: { id: userId } });
  if (isPremiumActive(user, now)) return;

  const synced = computeHearts(
    { hearts: user.hearts, lastHeartLossAt: user.lastHeartLossAt },
    false,
    now,
  );
  const newHearts = Math.min(MAX_HEARTS, synced.hearts + reward);
  await tx.user.update({
    where: { id: userId },
    data: {
      hearts: newHearts,
      lastHeartLossAt: newHearts >= MAX_HEARTS ? null : synced.lastHeartLossAt,
    },
  });
}

export const referralService = {
  /**
   * GET /me/referral — code de partage de l'utilisateur (généré à la demande)
   * + nombre de filleuls déjà parrainés + récompense par parrainage.
   */
  async getOrCreate(userId: string) {
    let user = await userRepository.getOrThrow(userId);

    // Génère un code unique à la première demande (retry en cas de collision).
    if (!user.referralCode) {
      for (let attempt = 0; attempt < 5 && !user.referralCode; attempt++) {
        try {
          user = await prisma.user.update({
            where: { id: userId },
            data: { referralCode: generateReferralCode() },
          });
        } catch (e) {
          // P2002 = violation d'unicité (code déjà pris) → on retente.
          if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') continue;
          throw e;
        }
      }
      if (!user.referralCode) {
        throw new AppError('INTERNAL', 'Could not generate a referral code');
      }
    }

    const referredCount = await prisma.user.count({ where: { referredById: userId } });
    return {
      code: user.referralCode,
      referredCount,
      rewardPerReferral: REFERRAL_HEART_REWARD,
    };
  },

  /**
   * POST /me/referral/redeem — le compte courant (jamais parrainé) saisit le
   * code d'un parrain. Parrain ET filleul reçoivent REFERRAL_HEART_REWARD cœurs.
   * Renvoie l'état plat /me du filleul (pour rehydrater le store front).
   */
  async redeem(userId: string, rawCode: string) {
    const code = normalizeReferralCode(rawCode);
    const me = await userRepository.getOrThrow(userId);
    if (me.referredById) {
      throw new AppError('CONFLICT', 'This account has already used a referral code');
    }

    const referrer = await prisma.user.findUnique({ where: { referralCode: code } });
    if (!referrer) throw new AppError('NOT_FOUND', 'Invalid referral code');
    if (referrer.id === userId) {
      throw new AppError('VALIDATION_ERROR', 'You cannot use your own referral code');
    }

    const now = new Date();
    await prisma.$transaction(async (tx) => {
      // Verrou + re-vérification anti-course : referredById doit toujours être
      // null au moment du claim (deux redeem concurrents ne récompensent qu'une
      // seule fois).
      const claim = await tx.user.updateMany({
        where: { id: userId, referredById: null },
        data: { referredById: referrer.id },
      });
      if (claim.count === 0) {
        throw new AppError('CONFLICT', 'This account has already used a referral code');
      }

      // Le filleul touche toujours ses cœurs de bienvenue ; le parrain n'est
      // récompensé que sous le plafond (ferme le farming par faux comptes).
      const rewardedCount = await tx.user.count({ where: { referredById: referrer.id } });
      if (rewardedCount <= REFERRAL_MAX_REWARDED_REFERRALS) {
        await grantHearts(tx, referrer.id, REFERRAL_HEART_REWARD, now);
      }
      await grantHearts(tx, userId, REFERRAL_HEART_REWARD, now);
    });

    const updated = await userRepository.getOrThrow(userId);
    const stats = await computeUserStats(userId);
    return serializeUserFlat(updated, stats, now);
  },
};

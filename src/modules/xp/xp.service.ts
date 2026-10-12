import type { Prisma } from '@prisma/client';
import { leagueService } from '../leagues/league.service.js';

/**
 * Ticket 0.B4 (règle 4) — « recalculer, jamais incrémenter ».
 *
 * Tout gain d'XP est écrit comme une ligne APPEND-ONLY dans `XpEvent`, puis le
 * compteur `weeklyXp` (sur `User` ET `LeagueMembership`) est RECALCULÉ comme la
 * somme des événements de la semaine de ligue courante. Aucun `increment` :
 * deux projections ne peuvent donc pas diverger, et une nouvelle semaine repart
 * naturellement de 0 (aucun événement rattaché).
 *
 * Toutes les méthodes supposent d'être appelées DANS une transaction Prisma du
 * client appelant (comme l'ancien `leagueService.addXpIfMemberTx`).
 */

/** Origine d'un gain d'XP. */
export type XpSource = 'lesson' | 'streak_goal' | 'podium' | 'daily_chest' | 'carryover';

export interface XpGrant {
  /** Semaine de ligue du gain (null si aucune semaine n'existe). */
  weekId: string | null;
  /** weeklyXp recalculé APRÈS ce gain (projection absolue, jamais un delta). */
  weeklyXp: number;
  /** Montant du gain (delta), pour l'affichage du gain de la session. */
  amount: number;
}

export const xpService = {
  /**
   * Recalcule `weeklyXp` (User + LeagueMembership) à partir du registre pour la
   * semaine donnée, puis renvoie la valeur. Écrit une valeur ABSOLUE : rejouer
   * la même opération donne le même résultat (idempotent).
   */
  async recomputeWeeklyXpTx(
    tx: Prisma.TransactionClient,
    userId: string,
    weekId: string | null,
  ): Promise<number> {
    const agg = await tx.xpEvent.aggregate({
      _sum: { amount: true },
      where: weekId
        ? { userId, leagueWeekId: weekId }
        : { userId, leagueWeekId: null },
    });
    const total = agg._sum.amount ?? 0;

    await tx.user.update({ where: { id: userId }, data: { weeklyXp: total } });
    if (weekId) {
      await tx.leagueMembership.updateMany({
        where: { userId, leagueWeekId: weekId },
        data: { weeklyXp: total },
      });
    }
    return total;
  },

  /**
   * Enregistre un gain d'XP (append-only) puis recalcule les totaux de la
   * semaine. Renvoie `null` si le gain est nul (rien à écrire).
   */
  async grantTx(
    tx: Prisma.TransactionClient,
    userId: string,
    amount: number,
    source: XpSource,
    ref?: string | null,
  ): Promise<XpGrant | null> {
    if (amount <= 0) return null;

    // Résout (et auto-enrôle si besoin) la semaine de ligue courante, pour que
    // l'événement soit rattaché à la bonne semaine.
    const weekId = await leagueService.ensureWeekMembershipTx(tx, userId);

    await tx.xpEvent.create({
      data: { userId, leagueWeekId: weekId, amount, source, ref: ref ?? null },
    });

    const weeklyXp = await this.recomputeWeeklyXpTx(tx, userId, weekId);
    return { weekId, weeklyXp, amount };
  },
};

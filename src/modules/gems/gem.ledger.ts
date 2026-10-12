import type { Prisma } from '@prisma/client';

/**
 * Ticket 0.B4bis (règle 4) — le solde de gemmes est RECALCULÉ depuis le registre
 * `GemTransaction` (somme signée : gains positifs, dépenses négatives), jamais
 * incrémenté. Le registre existant est la source de vérité depuis l'origine de
 * la colonne `gems` (les deux ont été créés ensemble, à 0), donc aucun
 * carryover n'est nécessaire.
 *
 * À appeler DANS la transaction de l'appelant, après avoir écrit la ou les
 * lignes de registre, et toujours avec la ligne `User` verrouillée (FOR UPDATE)
 * quand un contrôle de solde est nécessaire.
 */
export async function recomputeGemsTx(
  tx: Prisma.TransactionClient,
  userId: string,
): Promise<number> {
  const agg = await tx.gemTransaction.aggregate({
    _sum: { amount: true },
    where: { userId },
  });
  const total = agg._sum.amount ?? 0;
  await tx.user.update({ where: { id: userId }, data: { gems: total } });
  return total;
}

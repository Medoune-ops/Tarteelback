import type { FastifyRequest } from 'fastify';
import { AppError } from '../../core/errors.js';
import { prisma } from '../../config/prisma.js';
import { ensureFriendsConfigFresh } from '../../core/friendsConfig.js';

/**
 * preHandler commun à toutes les routes « amis », placé après `authenticate` :
 *  - rafraîchit l'interrupteur du back-office (cache de 10 s) pour que les
 *    gardes synchrones `requireFriendsEnabled` lisent la bonne valeur ;
 *  - refuse l'accès à un compte dont la modération a coupé les fonctions entre
 *    amis (User.friendsDisabledAt). Même code que l'interrupteur coupé : l'app
 *    masque simplement la fonctionnalité.
 */
export async function friendsGate(req: FastifyRequest): Promise<void> {
  await ensureFriendsConfigFresh();
  const userId = req.auth?.sub;
  if (!userId) return;
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { friendsDisabledAt: true },
  });
  if (user?.friendsDisabledAt) throw new AppError('FRIENDS_DISABLED');
}

/** Variante pour les routes publiques (sans compte) : config seulement. */
export async function friendsConfigGate(): Promise<void> {
  await ensureFriendsConfigFresh();
}

import { env } from '../../config/env.js';
import { AppError } from '../../core/errors.js';

/** Vrai si la fonctionnalité Amis est activée (flag serveur FRIENDS_ENABLED). */
export function isFriendsEnabled(): boolean {
  return env.FRIENDS_ENABLED;
}

/**
 * Garde des routes Amis. Quand FRIENDS_ENABLED est faux, la fonctionnalité
 * n'existe pas du point de vue du client : on renvoie un 404 générique (même
 * réponse que « route inconnue ») pour ne rien révéler.
 */
export function requireFriendsEnabled(): void {
  if (!env.FRIENDS_ENABLED) {
    throw new AppError('NOT_FOUND', 'Not found');
  }
}

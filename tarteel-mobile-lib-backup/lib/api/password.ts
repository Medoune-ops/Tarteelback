/**
 * Réinitialisation et changement de mot de passe.
 *
 *  - `POST /auth/reset-password/request` { email } → envoie un email avec un
 *    lien `APP_RESET_URL?token=...`. Ne nécessite pas d'être connecté.
 *  - `POST /auth/reset-password/confirm` { token, newPassword } → applique le
 *    nouveau mot de passe à partir du token reçu par email. Pas connecté.
 *  - `POST /auth/change-password` { currentPassword, newPassword } → change le
 *    mot de passe d'un utilisateur DÉJÀ connecté (depuis les paramètres).
 *
 * Réponse attendue : `{ ok: true }` ou erreur HTTP standard (gérée par ApiError).
 */
import { apiFetch } from './client';

/** Demande l'envoi d'un email de réinitialisation. Public (auth: false). */
export async function requestPasswordReset(email: string): Promise<void> {
  await apiFetch('/auth/reset-password/request', {
    method: 'POST',
    auth: false,
    json: { email },
  });
}

/** Confirme la réinitialisation avec le token reçu par email. Public. */
export async function confirmPasswordReset(token: string, newPassword: string): Promise<void> {
  await apiFetch('/auth/reset-password/confirm', {
    method: 'POST',
    auth: false,
    json: { token, newPassword },
  });
}

/** Change le mot de passe d'un utilisateur connecté. */
export async function changePassword(currentPassword: string, newPassword: string): Promise<void> {
  await apiFetch('/auth/change-password', {
    method: 'POST',
    json: { currentPassword, newPassword },
  });
}

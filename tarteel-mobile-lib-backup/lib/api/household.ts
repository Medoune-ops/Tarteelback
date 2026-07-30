/**
 * Foyer familial — gestion du plan familial (jusqu'à 5 comptes, un
 * propriétaire, abonnement partagé). Tous les endpoints sont préfixés
 * `/me/household` côté backend.
 */
import { apiFetch } from './client';

export interface HouseholdMemberView {
  userId: string;
  email: string;
  displayName: string;
  avatarInitials: string;
  role: 'owner' | 'member';
  joinedAt: string;
  isMe: boolean;
}

export interface HouseholdInvitationView {
  id: string;
  email: string;
  status: 'pending' | 'accepted' | 'declined' | 'expired' | 'cancelled';
  createdAt: string;
  expiresAt: string;
}

export interface ReceivedInvitationView {
  token: string;
  householdId: string;
  invitedBy: string;
  expiresAt: string;
}

export interface HouseholdView {
  household: {
    id: string;
    isOwner: boolean;
    subscriptionActive: boolean;
    subscriptionUntil: string | null;
    plan: string | null;
    maxMembers: number;
    members: HouseholdMemberView[];
    invitations: HouseholdInvitationView[];
  } | null;
  receivedInvitations: ReceivedInvitationView[];
}

/** GET /me/household — foyer courant + invitations reçues. */
export async function fetchHousehold(): Promise<HouseholdView> {
  return apiFetch<HouseholdView>('/me/household');
}

/** POST /me/household — crée un foyer (l'appelant devient propriétaire). */
export async function createHousehold(): Promise<HouseholdView> {
  return apiFetch<HouseholdView>('/me/household', { method: 'POST' });
}

/** DELETE /me/household — supprime le foyer (propriétaire uniquement). */
export async function deleteHousehold(): Promise<{ ok: true }> {
  return apiFetch<{ ok: true }>('/me/household', { method: 'DELETE' });
}

/** POST /me/household/leave — quitte le foyer (membre non-propriétaire). */
export async function leaveHousehold(): Promise<{ ok: true }> {
  return apiFetch<{ ok: true }>('/me/household/leave', { method: 'POST' });
}

/** POST /me/household/transfer — transfère la propriété à un autre membre. */
export async function transferHousehold(userId: string): Promise<HouseholdView> {
  return apiFetch<HouseholdView>('/me/household/transfer', { method: 'POST', json: { userId } });
}

/** POST /me/household/invitations — invite un compte par email. */
export async function inviteToHousehold(email: string): Promise<HouseholdView> {
  return apiFetch<HouseholdView>('/me/household/invitations', { method: 'POST', json: { email } });
}

/** POST /me/household/invitations/:token/accept — accepte une invitation reçue. */
export async function acceptHouseholdInvite(token: string): Promise<HouseholdView> {
  return apiFetch<HouseholdView>(`/me/household/invitations/${token}/accept`, { method: 'POST' });
}

/** POST /me/household/invitations/:token/decline — décline une invitation reçue. */
export async function declineHouseholdInvite(token: string): Promise<{ ok: true }> {
  return apiFetch<{ ok: true }>(`/me/household/invitations/${token}/decline`, { method: 'POST' });
}

/** DELETE /me/household/invitations/:id — annule une invitation envoyée (propriétaire). */
export async function cancelHouseholdInvite(id: string): Promise<HouseholdView> {
  return apiFetch<HouseholdView>(`/me/household/invitations/${id}`, { method: 'DELETE' });
}

/** DELETE /me/household/members/:userId — retire un membre (propriétaire). */
export async function removeHouseholdMember(userId: string): Promise<HouseholdView> {
  return apiFetch<HouseholdView>(`/me/household/members/${userId}`, { method: 'DELETE' });
}

import { prisma } from '../../config/prisma.js';
import { AppError } from '../../core/errors.js';
import {
  HOUSEHOLD_MAX_MEMBERS,
  INVITE_TTL_DAYS,
  recomputePremium,
  recomputeHouseholdPremium,
} from '../../core/household.js';

const DAY_MS = 24 * 60 * 60 * 1000;

/** Sélection publique d'un membre (pas de données sensibles). */
const memberUserSelect = {
  id: true,
  email: true,
  displayName: true,
  avatarInitials: true,
} as const;

/** Récupère l'email (minuscules) d'un utilisateur. */
async function emailOf(userId: string): Promise<string> {
  const u = await prisma.user.findUnique({ where: { id: userId }, select: { email: true } });
  if (!u) throw new AppError('NOT_FOUND', 'User not found');
  return u.email.toLowerCase();
}

export const householdService = {
  /**
   * GET /me/household — foyer de l'utilisateur (owner OU membre) avec ses
   * membres et invitations en attente, PLUS les invitations reçues à son email.
   */
  async getMine(userId: string) {
    const now = new Date();
    const membership = await prisma.householdMember.findUnique({
      where: { userId },
      include: {
        household: {
          include: {
            members: {
              include: { user: { select: memberUserSelect } },
              orderBy: { joinedAt: 'asc' },
            },
            invitations: {
              where: { status: 'pending', expiresAt: { gt: now } },
              orderBy: { createdAt: 'desc' },
            },
          },
        },
      },
    });

    const email = await emailOf(userId);
    const received = await prisma.householdInvitation.findMany({
      where: { email, status: 'pending', expiresAt: { gt: now } },
      include: { household: { include: { owner: { select: { displayName: true } } } } },
      orderBy: { createdAt: 'desc' },
    });

    const household = membership?.household
      ? {
          id: membership.household.id,
          isOwner: membership.role === 'owner',
          subscriptionActive:
            membership.household.subscriptionActive &&
            (membership.household.subscriptionUntil?.getTime() ?? 0) > now.getTime(),
          subscriptionUntil: membership.household.subscriptionUntil,
          plan: membership.household.plan,
          maxMembers: HOUSEHOLD_MAX_MEMBERS,
          members: membership.household.members.map((m) => ({
            userId: m.userId,
            email: m.user.email,
            displayName: m.user.displayName,
            avatarInitials: m.user.avatarInitials,
            role: m.role,
            joinedAt: m.joinedAt,
            isMe: m.userId === userId,
          })),
          // Invitations envoyées (visibles par le propriétaire seulement).
          invitations:
            membership.role === 'owner'
              ? membership.household.invitations.map((i) => ({
                  id: i.id,
                  email: i.email,
                  status: i.status,
                  createdAt: i.createdAt,
                  expiresAt: i.expiresAt,
                }))
              : [],
        }
      : null;

    return {
      household,
      receivedInvitations: received.map((i) => ({
        token: i.token,
        householdId: i.householdId,
        invitedBy: i.household.owner.displayName,
        expiresAt: i.expiresAt,
      })),
    };
  },

  /** POST /me/household — crée un foyer (l'utilisateur devient propriétaire). */
  async create(userId: string) {
    const existing = await prisma.householdMember.findUnique({ where: { userId } });
    if (existing) {
      throw new AppError('ALREADY_IN_HOUSEHOLD', 'Tu appartiens déjà à un foyer');
    }
    const household = await prisma.household.create({ data: { ownerId: userId } });
    await prisma.householdMember.create({
      data: { householdId: household.id, userId, role: 'owner' },
    });
    return this.getMine(userId);
  },

  /**
   * Garantit que `userId` possède un foyer (le crée sinon). Utilisé par
   * l'abonnement familial. Refuse si l'utilisateur est déjà membre d'un AUTRE
   * foyer (il doit le quitter d'abord).
   */
  async ensureOwned(userId: string) {
    const owned = await prisma.household.findUnique({ where: { ownerId: userId } });
    if (owned) return owned;
    const membership = await prisma.householdMember.findUnique({ where: { userId } });
    if (membership) {
      throw new AppError('ALREADY_IN_HOUSEHOLD', 'Quitte ton foyer actuel avant de créer le tien');
    }
    const household = await prisma.household.create({ data: { ownerId: userId } });
    await prisma.householdMember.create({
      data: { householdId: household.id, userId, role: 'owner' },
    });
    return household;
  },

  /** Garde : le foyer possédé par `userId`, sinon 403. */
  async ownedOrThrow(userId: string) {
    const household = await prisma.household.findUnique({ where: { ownerId: userId } });
    if (!household) {
      throw new AppError('NOT_HOUSEHOLD_OWNER', "Tu n'es pas propriétaire d'un foyer");
    }
    return household;
  },

  /** POST /me/household/invitations — invite un email (propriétaire, ≤ 5 places). */
  async invite(ownerId: string, email: string) {
    const household = await this.ownedOrThrow(ownerId);
    const lower = email.toLowerCase().trim();
    const now = new Date();

    if ((await emailOf(ownerId)) === lower) {
      throw new AppError('CONFLICT', 'Tu es déjà dans ce foyer');
    }

    // Capacité : membres actuels + invitations en attente < max.
    const [memberCount, pendingCount] = await Promise.all([
      prisma.householdMember.count({ where: { householdId: household.id } }),
      prisma.householdInvitation.count({
        where: { householdId: household.id, status: 'pending', expiresAt: { gt: now } },
      }),
    ]);
    if (memberCount + pendingCount >= HOUSEHOLD_MAX_MEMBERS) {
      throw new AppError('HOUSEHOLD_FULL', 'Le foyer est complet (5 comptes maximum)');
    }

    // Email déjà membre de CE foyer ?
    const invitedUser = await prisma.user.findUnique({
      where: { email: lower },
      select: { id: true },
    });
    if (invitedUser) {
      const already = await prisma.householdMember.findFirst({
        where: { householdId: household.id, userId: invitedUser.id },
      });
      if (already) throw new AppError('CONFLICT', 'Ce compte est déjà membre du foyer');
    }

    // Invitation en attente déjà envoyée à cet email ?
    const dup = await prisma.householdInvitation.findFirst({
      where: { householdId: household.id, email: lower, status: 'pending', expiresAt: { gt: now } },
    });
    if (dup) throw new AppError('CONFLICT', 'Une invitation est déjà en attente pour cet email');

    const expiresAt = new Date(now.getTime() + INVITE_TTL_DAYS * DAY_MS);
    const invitation = await prisma.householdInvitation.create({
      data: { householdId: household.id, email: lower, invitedById: ownerId, expiresAt },
    });
    // NB : l'envoi d'email réel se branche ici (core/mailer) — best-effort, non
    // bloquant : l'invitation est déjà persistée et récupérable via le token.
    return this.getMine(ownerId);
  },

  /** POST /me/household/invitations/:token/accept — accepte et rattache le compte. */
  async accept(userId: string, token: string) {
    const email = await emailOf(userId);
    const invitation = await prisma.householdInvitation.findUnique({ where: { token } });
    if (!invitation || invitation.status !== 'pending') {
      throw new AppError('INVITATION_INVALID', 'Invitation invalide ou déjà traitée');
    }
    if (invitation.email.toLowerCase() !== email) {
      throw new AppError('FORBIDDEN', "Cette invitation ne t'est pas destinée");
    }
    if (invitation.expiresAt.getTime() <= Date.now()) {
      await prisma.householdInvitation.update({
        where: { id: invitation.id },
        data: { status: 'expired' },
      });
      throw new AppError('INVITATION_EXPIRED', 'Cette invitation a expiré');
    }

    const existing = await prisma.householdMember.findUnique({ where: { userId } });
    if (existing) {
      throw new AppError('ALREADY_IN_HOUSEHOLD', "Quitte d'abord ton foyer actuel");
    }
    const memberCount = await prisma.householdMember.count({
      where: { householdId: invitation.householdId },
    });
    if (memberCount >= HOUSEHOLD_MAX_MEMBERS) {
      throw new AppError('HOUSEHOLD_FULL', 'Le foyer est complet');
    }

    await prisma.$transaction([
      prisma.householdMember.create({
        data: { householdId: invitation.householdId, userId, role: 'member' },
      }),
      prisma.householdInvitation.update({
        where: { id: invitation.id },
        data: { status: 'accepted', respondedAt: new Date() },
      }),
    ]);
    await recomputePremium(userId); // hérite immédiatement du premium familial
    return this.getMine(userId);
  },

  /** POST /me/household/invitations/:token/decline — refuse l'invitation. */
  async decline(userId: string, token: string) {
    const email = await emailOf(userId);
    const invitation = await prisma.householdInvitation.findUnique({ where: { token } });
    if (!invitation || invitation.status !== 'pending') {
      throw new AppError('INVITATION_INVALID', 'Invitation invalide ou déjà traitée');
    }
    if (invitation.email.toLowerCase() !== email) {
      throw new AppError('FORBIDDEN', "Cette invitation ne t'est pas destinée");
    }
    await prisma.householdInvitation.update({
      where: { id: invitation.id },
      data: { status: 'declined', respondedAt: new Date() },
    });
    return { ok: true };
  },

  /** DELETE /me/household/invitations/:id — le propriétaire annule une invitation. */
  async cancelInvitation(ownerId: string, invitationId: string) {
    const household = await this.ownedOrThrow(ownerId);
    const invitation = await prisma.householdInvitation.findUnique({ where: { id: invitationId } });
    if (!invitation || invitation.householdId !== household.id) {
      throw new AppError('NOT_FOUND', 'Invitation introuvable');
    }
    if (invitation.status === 'pending') {
      await prisma.householdInvitation.update({
        where: { id: invitation.id },
        data: { status: 'cancelled', respondedAt: new Date() },
      });
    }
    return this.getMine(ownerId);
  },

  /** DELETE /me/household/members/:userId — le propriétaire retire un membre. */
  async removeMember(ownerId: string, targetUserId: string) {
    const household = await this.ownedOrThrow(ownerId);
    if (targetUserId === ownerId) {
      throw new AppError(
        'FORBIDDEN',
        'Le propriétaire ne peut pas se retirer : transfère la propriété ou supprime le foyer',
      );
    }
    const member = await prisma.householdMember.findFirst({
      where: { householdId: household.id, userId: targetUserId },
    });
    if (!member) throw new AppError('NOT_FOUND', 'Membre introuvable dans ce foyer');
    await prisma.householdMember.delete({ where: { id: member.id } });
    await recomputePremium(targetUserId); // perd le premium familial
    return this.getMine(ownerId);
  },

  /** POST /me/household/leave — un membre (non propriétaire) quitte le foyer. */
  async leave(userId: string) {
    const member = await prisma.householdMember.findUnique({ where: { userId } });
    if (!member) throw new AppError('NOT_FOUND', "Tu n'appartiens à aucun foyer");
    if (member.role === 'owner') {
      throw new AppError(
        'FORBIDDEN',
        'Le propriétaire doit transférer la propriété ou supprimer le foyer',
      );
    }
    await prisma.householdMember.delete({ where: { id: member.id } });
    await recomputePremium(userId);
    return { ok: true };
  },

  /** POST /me/household/transfer — transfère la propriété à un membre existant. */
  async transfer(ownerId: string, newOwnerUserId: string) {
    const household = await this.ownedOrThrow(ownerId);
    if (newOwnerUserId === ownerId) throw new AppError('CONFLICT', 'Tu es déjà propriétaire');
    const newMember = await prisma.householdMember.findFirst({
      where: { householdId: household.id, userId: newOwnerUserId },
    });
    if (!newMember) {
      throw new AppError('NOT_FOUND', 'Le nouveau propriétaire doit être membre du foyer');
    }
    const oldMember = await prisma.householdMember.findFirst({
      where: { householdId: household.id, userId: ownerId },
    });
    await prisma.$transaction([
      prisma.household.update({ where: { id: household.id }, data: { ownerId: newOwnerUserId } }),
      prisma.householdMember.update({ where: { id: newMember.id }, data: { role: 'owner' } }),
      ...(oldMember
        ? [prisma.householdMember.update({ where: { id: oldMember.id }, data: { role: 'member' } })]
        : []),
    ]);
    return this.getMine(newOwnerUserId);
  },

  /** DELETE /me/household — le propriétaire supprime le foyer (détache tous). */
  async remove(ownerId: string) {
    const household = await this.ownedOrThrow(ownerId);
    const members = await prisma.householdMember.findMany({
      where: { householdId: household.id },
      select: { userId: true },
    });
    // Cascade : supprime membres + invitations.
    await prisma.household.delete({ where: { id: household.id } });
    for (const m of members) await recomputePremium(m.userId); // premium recalculé (perte du familial)
    return { ok: true };
  },

  /**
   * Active/étend l'abonnement familial du foyer possédé par `ownerId` (crée le
   * foyer si besoin) puis recalcule le premium de TOUS les membres. Appelé par
   * le module billing après un paiement réussi.
   */
  async activateSubscription(ownerId: string, plan: string, isYearly: boolean, now: Date) {
    const household = await this.ensureOwned(ownerId);
    const base =
      household.subscriptionUntil && household.subscriptionUntil > now
        ? household.subscriptionUntil
        : now;
    const until = new Date(base);
    if (isYearly) until.setFullYear(until.getFullYear() + 1);
    else until.setMonth(until.getMonth() + 1);
    await prisma.household.update({
      where: { id: household.id },
      data: { subscriptionActive: true, subscriptionUntil: until, plan },
    });
    await recomputeHouseholdPremium(household.id, now);
    return until;
  },

  /**
   * Maintenance : désactive les abonnements familiaux expirés (+ recalcul du
   * premium de leurs membres) et marque les invitations expirées.
   */
  async expireDue(now: Date = new Date()) {
    const expired = await prisma.household.findMany({
      where: { subscriptionActive: true, subscriptionUntil: { lt: now } },
      select: { id: true },
    });
    for (const h of expired) {
      await prisma.household.update({
        where: { id: h.id },
        data: { subscriptionActive: false },
      });
      await recomputeHouseholdPremium(h.id, now);
    }
    await prisma.householdInvitation.updateMany({
      where: { status: 'pending', expiresAt: { lt: now } },
      data: { status: 'expired' },
    });
    return { households: expired.length };
  },
};

import { prisma } from '../config/prisma.js';

/**
 * Règles métier & résolution du premium pour le plan familial (foyer).
 *
 * `User.isPremium` / `User.premiumUntil` = premium EFFECTIF (personnel OU
 * familial), matérialisé ici pour que tous les contrôles existants
 * (isPremiumActive) restent valables. `User.personalPremiumUntil` = source du
 * premium personnel (abonnement individuel). Le premium familial vient du
 * foyer (Household.subscriptionUntil quand subscriptionActive).
 */

/** Nombre max de membres d'un foyer, propriétaire inclus. */
export const HOUSEHOLD_MAX_MEMBERS = 5;
/** Durée de validité d'une invitation (jours). */
export const INVITE_TTL_DAYS = 7;

export const FAMILY_PLANS = ['famille_mensuel', 'famille_annuel'] as const;
export type FamilyPlan = (typeof FAMILY_PLANS)[number];
export function isFamilyPlan(plan: string): plan is FamilyPlan {
  return (FAMILY_PLANS as readonly string[]).includes(plan);
}

/**
 * Fin de premium EFFECTIVE = la plus tardive entre le premium personnel et le
 * premium familial (chacun compté seulement s'il est encore actif).
 * null = aucun premium actif.
 */
export function resolveEffectiveUntil(
  personalUntil: Date | null,
  familyUntil: Date | null,
  now: Date,
): Date | null {
  const p = personalUntil && personalUntil.getTime() > now.getTime() ? personalUntil : null;
  const f = familyUntil && familyUntil.getTime() > now.getTime() ? familyUntil : null;
  if (!p) return f;
  if (!f) return p;
  return p.getTime() >= f.getTime() ? p : f;
}

/** Fin d'abonnement FAMILIAL actif pour un user (via son foyer), sinon null. */
export async function familyPremiumUntil(userId: string, now: Date): Promise<Date | null> {
  const membership = await prisma.householdMember.findUnique({
    where: { userId },
    include: { household: true },
  });
  const h = membership?.household;
  if (!h || !h.subscriptionActive || !h.subscriptionUntil) return null;
  return h.subscriptionUntil.getTime() > now.getTime() ? h.subscriptionUntil : null;
}

/**
 * Recalcule et matérialise le premium EFFECTIF d'un user (personnel + familial)
 * dans User.isPremium / User.premiumUntil. À appeler après tout changement
 * d'appartenance au foyer ou d'abonnement.
 */
export async function recomputePremium(userId: string, now: Date = new Date()): Promise<void> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { personalPremiumUntil: true },
  });
  if (!user) return;
  const familyUntil = await familyPremiumUntil(userId, now);
  const until = resolveEffectiveUntil(user.personalPremiumUntil, familyUntil, now);
  await prisma.user.update({
    where: { id: userId },
    data: { isPremium: until != null, premiumUntil: until },
  });
}

/** Recalcule le premium de TOUS les membres d'un foyer (après (dés)activation). */
export async function recomputeHouseholdPremium(
  householdId: string,
  now: Date = new Date(),
): Promise<void> {
  const members = await prisma.householdMember.findMany({
    where: { householdId },
    select: { userId: true },
  });
  for (const m of members) await recomputePremium(m.userId, now);
}

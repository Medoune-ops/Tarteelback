import { prisma } from '../../config/prisma.js';
import { AppError } from '../../core/errors.js';
import { env } from '../../config/env.js';
import { MAX_HEARTS } from '../../core/hearts.js';
import { adminUsersRepository } from './adminUsers.repository.js';
import { serializeAdminUser } from './adminUsers.serializer.js';
import { notificationService } from '../notifications/notification.service.js';
import { resolveI18n } from '../content/content.serializer.js';
import type { ListUsersQuery } from './adminUsers.schemas.js';

/** Correspond à `GiftKind` côté frontend (store/giftModalStore.ts). */
type GiftKind = 'hearts' | 'gems' | 'premium';

/**
 * Corps du push, dans la langue de l'utilisateur (`resolveI18n`, même
 * mécanisme que les titres de leçon — voir schema.prisma pour la règle i18n).
 */
function grantBody(kind: GiftKind, amount: number, lang: string): string {
  const s = amount > 1 ? 's' : '';
  if (kind === 'hearts') {
    return resolveI18n({ fr: `Tu as reçu ${amount} cœur${s} !`, en: `You received ${amount} heart${s}!` }, lang, env.DEFAULT_LANG);
  }
  if (kind === 'gems') {
    return resolveI18n({ fr: `Tu as reçu ${amount} gemme${s} !`, en: `You received ${amount} gem${s}!` }, lang, env.DEFAULT_LANG);
  }
  // premium : amount = durationDays, ou 0 pour "à vie" (voir grantPremium)
  return amount === 0
    ? resolveI18n({ fr: 'Tu as reçu Tarteel Plus à vie !', en: 'You received Tarteel Plus for life!' }, lang, env.DEFAULT_LANG)
    : resolveI18n(
        { fr: `Tu as reçu Tarteel Plus pour ${amount} jour${amount > 1 ? 's' : ''} !`, en: `You received Tarteel Plus for ${amount} day${amount > 1 ? 's' : ''}!` },
        lang,
        env.DEFAULT_LANG,
      );
}

/**
 * Prévient l'utilisateur d'un geste admin (cœurs/gemmes/premium) par DEUX
 * canaux complémentaires :
 *  - un `PendingGift` en base, que le client poll (GET /me/pending-gift)
 *    toutes les ~15s tant que l'app est ouverte — fonctionne sur Expo Go,
 *    sans build natif, et déclenche la modale cadeau animée en quasi
 *    temps réel (app/(app)/_layout.tsx).
 *  - un push Expo classique, pour l'utilisateur app fermée (notification
 *    système). Best-effort : notificationService.sendToUser ne throw jamais.
 * Aucun des deux ne doit faire échouer l'action admin elle-même. Le corps du
 * push est résolu dans la langue de l'utilisateur (`user.language`).
 */
async function notifyGrant(userId: string, lang: string, kind: GiftKind, amount: number) {
  await prisma.pendingGift.create({ data: { userId, kind, amount } }).catch(() => {});
  const body = grantBody(kind, amount, lang);
  notificationService
    .sendToUser(userId, { title: 'Tarteel', body, data: { type: 'admin_grant', kind, amount } })
    .catch(() => {});
}

export const adminUsersService = {
  async list(query: ListUsersQuery) {
    const { rows, total } = await adminUsersRepository.list(query.q, query.status, query.page, query.pageSize);
    return {
      users: rows.map((r) => serializeAdminUser(r)),
      pagination: { page: query.page, pageSize: query.pageSize, total, totalPages: Math.ceil(total / query.pageSize) },
    };
  },

  async ban(userId: string, reason: string | undefined) {
    const user = await adminUsersRepository.findById(userId);
    if (!user) throw new AppError('NOT_FOUND', 'User not found');
    const now = new Date();
    const updated = await adminUsersRepository.ban(userId, reason, now);
    // A ban must also kill any session the user is currently using.
    await adminUsersRepository.revokeAllSessions(userId, now);
    return serializeAdminUser({ ...updated, leagueMemberships: [] });
  },

  async unban(userId: string) {
    const user = await adminUsersRepository.findById(userId);
    if (!user) throw new AppError('NOT_FOUND', 'User not found');
    const updated = await adminUsersRepository.unban(userId);
    return serializeAdminUser({ ...updated, leagueMemberships: [] });
  },

  async grantHearts(userId: string, amount: number) {
    const user = await adminUsersRepository.findById(userId);
    if (!user) throw new AppError('NOT_FOUND', 'User not found');
    const newHearts = Math.min(MAX_HEARTS, user.hearts + amount);
    const updated = await adminUsersRepository.grantHearts(userId, newHearts);
    await notifyGrant(userId, user.language, 'hearts', amount);
    return serializeAdminUser({ ...updated, leagueMemberships: [] });
  },

  async grantGems(userId: string, amount: number) {
    const user = await adminUsersRepository.findById(userId);
    if (!user) throw new AppError('NOT_FOUND', 'User not found');
    const updated = await adminUsersRepository.grantGems(userId, amount);
    await notifyGrant(userId, user.language, 'gems', amount);
    return serializeAdminUser({ ...updated, leagueMemberships: [] });
  },

  async grantPremium(userId: string, durationDays: number | 'lifetime') {
    const user = await adminUsersRepository.findById(userId);
    if (!user) throw new AppError('NOT_FOUND', 'User not found');
    let premiumUntil: Date | null = null;
    if (durationDays !== 'lifetime') {
      premiumUntil = new Date(Date.now() + durationDays * 24 * 60 * 60 * 1000);
    }
    const updated = await adminUsersRepository.grantPremium(userId, premiumUntil);
    await notifyGrant(userId, user.language, 'premium', durationDays === 'lifetime' ? 0 : durationDays);
    return serializeAdminUser({ ...updated, leagueMemberships: [] });
  },
};

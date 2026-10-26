import { prisma } from '../config/prisma.js';

/**
 * Réglages des fonctions entre amis, modifiables depuis le back-office
 * (AppConfig) sans redéploiement. Lus très souvent (chaque requête « amis »),
 * donc gardés en mémoire 10 s : un changement au back-office s'applique en
 * 10 s au plus sur chaque instance.
 *
 * Les gardes existantes (`requireFriendsEnabled`) sont synchrones : elles lisent
 * ce cache, qu'un preHandler (`ensureFriendsConfigFresh`) rafraîchit avant.
 */
export interface FriendsConfig {
  friendsEnabled: boolean;
  friendsBetaUserIds: string[];
  challengeRewardsEnabled: boolean;
  challengeWinGems: number;
  challengeCompleteGems: number;
  challengeRewardedPerWeek: number;
  messagesPerDayFree: number;
  messagesPerDayPremium: number;
}

export const DEFAULT_FRIENDS_CONFIG: FriendsConfig = {
  friendsEnabled: false,
  friendsBetaUserIds: [],
  challengeRewardsEnabled: true,
  challengeWinGems: 50,
  challengeCompleteGems: 20,
  challengeRewardedPerWeek: 3,
  messagesPerDayFree: 3,
  messagesPerDayPremium: 30,
};

const TTL_MS = 10_000;

let cached: FriendsConfig = { ...DEFAULT_FRIENDS_CONFIG };
let loadedAt = 0;
let inflight: Promise<FriendsConfig> | null = null;

/** Dernière valeur connue (synchrone). */
export function friendsConfig(): FriendsConfig {
  return cached;
}

async function load(): Promise<FriendsConfig> {
  const row = await prisma.appConfig.upsert({
    where: { id: 'singleton' },
    update: {},
    create: { id: 'singleton' },
  });
  cached = {
    friendsEnabled: row.friendsEnabled,
    friendsBetaUserIds: row.friendsBetaUserIds ?? [],
    challengeRewardsEnabled: row.challengeRewardsEnabled,
    challengeWinGems: row.challengeWinGems,
    challengeCompleteGems: row.challengeCompleteGems,
    challengeRewardedPerWeek: row.challengeRewardedPerWeek,
    messagesPerDayFree: row.messagesPerDayFree,
    messagesPerDayPremium: row.messagesPerDayPremium,
  };
  loadedAt = Date.now();
  return cached;
}

/** Rafraîchit le cache s'il a plus de 10 s. En cas d'erreur de lecture, on
 *  garde la dernière valeur connue (jamais d'échec de requête pour ça). */
export async function ensureFriendsConfigFresh(): Promise<FriendsConfig> {
  if (Date.now() - loadedAt < TTL_MS) return cached;
  if (!inflight) {
    inflight = load()
      .catch((error) => {
        // eslint-disable-next-line no-console
        console.error('[friendsConfig] lecture impossible, valeur précédente conservée', error);
        return cached;
      })
      .finally(() => {
        inflight = null;
      });
  }
  return inflight;
}

/** Après un PATCH au back-office : la prochaine lecture repart de la base. */
export function invalidateFriendsConfig(): void {
  loadedAt = 0;
}

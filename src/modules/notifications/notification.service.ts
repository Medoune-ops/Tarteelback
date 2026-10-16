import { AppError } from '../../core/errors.js';
import { notificationRepository } from './notification.repository.js';
import {
  sendPush,
  isUnrecoverableToken,
  isExpoPushToken,
  type PushMessage,
} from './expoPush.js';
import { userRepository } from '../me/user.repository.js';
import { redis } from '../../config/redis.js';
import { getFriendMessage, FRIEND_PUSH_TYPES, type FriendPushType } from './friendsMessages.js';

export const FRIEND_PUSH_COOLDOWN_MS = 5 * 60 * 1000;

type FriendPushInput = {
  type?: FriendPushType | string;
  id?: string;
  data?: Record<string, unknown>;
  title?: string;
  body?: string;
  lang?: string;
};

const friendPushLastSent = new Map<string, number>();

async function acquireFriendPushSlot(userId: string): Promise<boolean> {
  if (redis) {
    const ok = await redis.set(`friends:push:${userId}`, '1', 'PX', FRIEND_PUSH_COOLDOWN_MS, 'NX');
    return ok === 'OK';
  }
  const now = Date.now();
  const last = friendPushLastSent.get(userId) ?? 0;
  if (now - last < FRIEND_PUSH_COOLDOWN_MS) return false;
  friendPushLastSent.set(userId, now);
  return true;
}

function friendTypeOf(data: Record<string, unknown> | undefined): string | null {
  const t = data?.type;
  return typeof t === 'string' ? t : null;
}

function isFriendPush(data: Record<string, unknown> | undefined): boolean {
  const t = friendTypeOf(data);
  if (!t) return false;
  if ((FRIEND_PUSH_TYPES as readonly string[]).includes(t)) return true;
  return /^friend_/i.test(t) || /^challenge_/i.test(t);
}

export const notificationService = {
  /** Register/refresh a device's Expo push token for the user. */
  async registerToken(
    userId: string,
    input: { token: string; deviceId: string; platform?: string },
  ) {
    if (!isExpoPushToken(input.token)) {
      throw new AppError('VALIDATION_ERROR', 'Invalid Expo push token');
    }
    await notificationRepository.upsertToken({ userId, ...input });
    return { registered: true };
  },

  async removeToken(userId: string, token: string) {
    await notificationRepository.deleteToken(userId, token);
    return { removed: true };
  },

  /**
   * Send a notification to all of a user's active devices. Disables any token
   * Expo reports as no longer registered. Returns how many were delivered.
   *
   * Pushes "amis" (data.type ami / défi) respectent la préférence
   * `notifFriends` et sont limités à 1 toutes les 5 min par personne.
   */
  async sendToUser(
    userId: string,
    payload: { title: string; body: string; data?: Record<string, unknown> },
  ): Promise<{ sent: number; disabled: number; skipped?: boolean; rateLimited?: boolean }> {
    const friend = isFriendPush(payload.data);

    if (friend) {
      let user;
      try {
        user = await userRepository.getOrThrow(userId);
      } catch {
        user = null;
      }
      if (!user || !user.notifFriends) {
        return { sent: 0, disabled: 0, skipped: true };
      }
      const slot = await acquireFriendPushSlot(userId);
      if (!slot) {
        return { sent: 0, disabled: 0, rateLimited: true };
      }
    }

    const tokens = await notificationRepository.activeTokensForUser(userId);
    if (tokens.length === 0) return { sent: 0, disabled: 0, ...(friend ? {} : {}) };

    const messages: PushMessage[] = tokens.map((t) => ({ to: t.token, ...payload }));
    const tickets = await sendPush(messages);

    const toDisable: string[] = [];
    let sent = 0;
    tickets.forEach((ticket, i) => {
      if (ticket.status === 'ok') sent++;
      else if (isUnrecoverableToken(ticket)) toDisable.push(tokens[i]!.token);
    });
    if (toDisable.length) await notificationRepository.disableTokens(toDisable);

    return { sent, disabled: toDisable.length };
  },

  /** Variante explicite pour un push amis (respecte notifFriends + rate-limit). */
  async sendFriendPush(
    userId: string,
    input: FriendPushInput = {},
  ) {
    const type = (input.data?.type ?? input.type ?? 'friend_request') as string;
    const id = (input.data?.id ?? input.id) as string | undefined;
    const msg = getFriendMessage(type, input.lang);
    const data = { type, ...(id ? { id } : {}), ...(input.data ?? {}) };
    return this.sendToUser(userId, {
      title: input.title ?? msg.title,
      body: input.body ?? msg.body,
      data,
    });
  },

  async sendFriendNotification(
    userId: string,
    input?: FriendPushInput,
  ) {
    return this.sendFriendPush(userId, input);
  },

  async notifyFriend(
    userId: string,
    input?: FriendPushInput,
  ) {
    return this.sendFriendPush(userId, input);
  },

  async sendFriendsPush(
    userId: string,
    input?: FriendPushInput,
  ) {
    return this.sendFriendPush(userId, input);
  },
};

export type NotificationService = typeof notificationService;

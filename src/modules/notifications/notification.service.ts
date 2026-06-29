import { AppError } from '../../core/errors.js';
import { notificationRepository } from './notification.repository.js';
import {
  sendPush,
  isUnrecoverableToken,
  isExpoPushToken,
  type PushMessage,
} from './expoPush.js';

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
   */
  async sendToUser(
    userId: string,
    payload: { title: string; body: string; data?: Record<string, unknown> },
  ): Promise<{ sent: number; disabled: number }> {
    const tokens = await notificationRepository.activeTokensForUser(userId);
    if (tokens.length === 0) return { sent: 0, disabled: 0 };

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
};

import { adminAuthRepository } from '../adminAuth/adminAuth.repository.js';
import { adminNotificationsRepository } from './adminNotifications.repository.js';
import { sendPush, isUnrecoverableToken, type PushMessage } from '../notifications/expoPush.js';
import type { BroadcastInput } from './adminNotifications.schemas.js';

const ACTION = 'notification.broadcast';

export const adminNotificationsService = {
  /**
   * Sends a real push notification to every active device in the chosen
   * audience segment, disables tokens Expo reports as dead, then logs the
   * broadcast (with delivery counts) to the shared admin activity log so the
   * back-office history reflects what was actually sent, not a local echo.
   */
  async broadcast(adminUserId: string, input: BroadcastInput) {
    const tokens = await adminNotificationsRepository.activeTokensForAudience(input.audience);

    let sent = 0;
    let disabled = 0;
    if (tokens.length > 0) {
      const messages: PushMessage[] = tokens.map((token) => ({
        to: token,
        title: input.title,
        body: input.message,
        data: { kind: 'announcement', type: input.type },
      }));
      const tickets = await sendPush(messages);
      const toDisable: string[] = [];
      tickets.forEach((ticket, i) => {
        if (ticket.status === 'ok') sent++;
        else if (isUnrecoverableToken(ticket)) toDisable.push(tokens[i]!);
      });
      if (toDisable.length) await adminNotificationsRepository.disableTokens(toDisable);
      disabled = toDisable.length;
    }

    await adminAuthRepository.logActivity({
      adminUserId,
      action: ACTION,
      metadata: {
        type: input.type,
        title: input.title,
        message: input.message,
        audience: input.audience,
        targeted: tokens.length,
        sent,
        disabled,
      },
    });

    return { targeted: tokens.length, sent, disabled };
  },

  /** Recent broadcasts, most recent first, for the back-office announcement history. */
  async history(limit?: number) {
    const rows = await adminAuthRepository.listActivity({ action: ACTION }, limit ?? 30);
    return rows
      .map((row) => ({
        id: row.id,
        sentAt: row.createdAt,
        sentBy: row.adminUser.displayName,
        ...(row.metadata as {
          type: string;
          title: string;
          message: string;
          audience: string;
          targeted: number;
          sent: number;
          disabled: number;
        }),
      }));
  },
};

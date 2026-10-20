import { registerOutboxHandler } from '../../core/outbox.js';
import { prisma } from '../../config/prisma.js';
import { userRepository } from '../me/user.repository.js';
import { notificationService } from '../notifications/notification.service.js';

registerOutboxHandler('message', async (event) => {
  const recipient = await userRepository.findById(event.userId);
  if (!recipient || !recipient.notifFriends) return;

  const payload = (event.payload ?? {}) as {
    senderId?: string;
    kind?: string;
  };
  const senderId = payload.senderId;
  if (!senderId) return;

  const sender = await prisma.user.findUnique({
    where: { id: senderId },
    select: { id: true, displayName: true, username: true },
  });
  if (!sender) return;

  const senderName = sender.displayName ?? sender.username ?? 'Un ami';

  await notificationService.sendFriendPush(event.userId, {
    type: 'message',
    id: event.id,
    lang: recipient.language,
    data: {
      type: 'message',
      id: event.id,
      sender: senderName,
      kind: payload.kind,
    },
  });
});

export function registerMessagePushHandlers(): void {
  // no-op: registration happens on import
}

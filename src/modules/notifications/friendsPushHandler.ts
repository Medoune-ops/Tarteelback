import { registerOutboxHandler } from '../../core/outbox.js';
import { userRepository } from '../me/user.repository.js';
import { notificationService } from './notification.service.js';

registerOutboxHandler('friend.request.created', async (event) => {
  const user = await userRepository.findById(event.userId);
  if (!user || !user.notifFriends) return;
  const payload = (event.payload ?? {}) as { friendshipId?: string };
  await notificationService.sendFriendPush(event.userId, {
    type: 'friend_request',
    id: payload.friendshipId ?? event.id,
    lang: user.language,
  });
});

registerOutboxHandler('friend.request.accepted', async (event) => {
  const user = await userRepository.findById(event.userId);
  if (!user || !user.notifFriends) return;
  const payload = (event.payload ?? {}) as { friendshipId?: string };
  await notificationService.sendFriendPush(event.userId, {
    type: 'friend_accepted',
    id: payload.friendshipId ?? event.id,
    lang: user.language,
  });
});

export function registerFriendPushHandlers(): void {
  // no-op: registration happens on import
}

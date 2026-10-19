import { registerOutboxHandler } from '../../core/outbox.js';
import { userRepository } from '../me/user.repository.js';
import { notificationService } from '../notifications/notification.service.js';

registerOutboxHandler('challenge_invite', async (event) => {
  const user = await userRepository.findById(event.userId);
  if (!user || !user.notifFriends) return;
  const payload = (event.payload ?? {}) as { type?: string; id?: string };
  await notificationService.sendFriendPush(event.userId, {
    type: 'challenge_invite',
    id: payload.id ?? event.id,
    lang: user.language,
    data: { type: payload.type, id: payload.id },
  });
});

registerOutboxHandler('challenge_started', async (event) => {
  const user = await userRepository.findById(event.userId);
  if (!user || !user.notifFriends) return;
  const payload = (event.payload ?? {}) as { type?: string; id?: string };
  await notificationService.sendFriendPush(event.userId, {
    type: 'challenge_started',
    id: payload.id ?? event.id,
    lang: user.language,
    data: { type: payload.type, id: payload.id },
  });
});

export function registerChallengePushHandlers(): void {
  // no-op: registration happens on import
}

import { registerOutboxHandler } from '../../core/outbox.js';
import { prisma } from '../../config/prisma.js';
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

registerOutboxHandler('challenge.finished', async (event) => {
  const payload = (event.payload ?? {}) as {
    challengeId?: string;
    winnerIds?: string[];
    participantIds?: string[];
  };
  const challengeId = payload.challengeId;
  if (!challengeId) return;

  const challenge = await prisma.challenge.findUnique({
    where: { id: challengeId },
    include: { participants: true },
  });
  if (!challenge) return;

  const winnerSet = new Set((payload.winnerIds ?? []) as string[]);

  for (const participant of challenge.participants) {
    const user = await userRepository.findById(participant.userId);
    if (!user || !user.notifFriends) continue;

    const isWinner = winnerSet.has(participant.userId);
    await notificationService.sendFriendPush(participant.userId, {
      type: isWinner ? 'challenge_win' : 'challenge_complete',
      id: challengeId,
      lang: user.language,
      data: {
        type: isWinner ? 'challenge_win' : 'challenge_complete',
        id: challengeId,
        winner: isWinner,
        title: challenge.title,
      },
    });
  }
});

registerOutboxHandler('challenge_nudge', async (event) => {
  const payload = (event.payload ?? {}) as {
    challengeId?: string;
    nudgedBy?: string;
  };
  const challengeId = payload.challengeId;
  if (!challengeId) return;

  const challenge = await prisma.challenge.findUnique({
    where: { id: challengeId },
  });
  if (!challenge) return;

  const nudgedUser = await userRepository.findById(event.userId);
  if (!nudgedUser || !nudgedUser.notifFriends) return;

  const nudger = await userRepository.findById(payload.nudgedBy ?? '');

  await notificationService.sendFriendPush(event.userId, {
    type: 'challenge_nudge',
    id: challengeId,
    lang: nudgedUser.language,
    data: {
      type: 'challenge_nudge',
      id: challengeId,
      challenger: nudger?.displayName ?? nudger?.username ?? 'Un ami',
      title: challenge.title,
    },
  });
});

export function registerChallengePushHandlers(): void {
  // no-op: registration happens on import
}

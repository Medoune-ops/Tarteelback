/**
 * Textes des notifications "amis" (ticket 0.B7).
 * Bilingues (fr / en). Un message par type, avec un titre et un corps.
 */

export type FriendPushType =
  | 'friend_request'
  | 'friend_accepted'
  | 'challenge_invite'
  | 'challenge_update'
  | 'challenge_win'
  | 'challenge_complete'
  | 'challenge_nudge'
  | 'challenge_started'
  | 'challenge_cancelled'
  | 'friend_cheer';

export interface FriendPushMessage {
  title: string;
  body: string;
}

export const friendsMessages = {
  en: {
    friend_request: { title: 'Tarteel Friends', body: 'Someone sent you a friend request.' },
    friend_accepted: { title: 'Tarteel Friends', body: 'Your friend request was accepted.' },
    challenge_invite: { title: 'Tarteel Challenge', body: 'A friend challenged you to a Surah.' },
    challenge_update: { title: 'Tarteel Challenge', body: 'A challenge has been updated.' },
    challenge_win: { title: 'Challenge Won!', body: 'You won a friends challenge.' },
    challenge_complete: { title: 'Challenge Completed', body: 'You completed a friends challenge.' },
    challenge_nudge: { title: 'Challenge nudge', body: 'A friend reminded you about a challenge.' },
    challenge_started: { title: 'Tarteel Challenge', body: 'Your challenge has started. Good luck!' },
    challenge_cancelled: { title: 'Tarteel Challenge', body: 'A challenge was cancelled.' },
    friend_cheer: { title: 'Tarteel Friends', body: 'A friend cheered you on.' },
  },
  fr: {
    friend_request: { title: 'Amis Tarteel', body: 'Quelqu\'un vous a envoyé une demande d\'amitié.' },
    friend_accepted: { title: 'Amis Tarteel', body: 'Votre demande d\'amitié a été acceptée.' },
    challenge_invite: { title: 'Défi Tarteel', body: 'Un ami vous a lancé un défi sur une Sourate.' },
    challenge_update: { title: 'Défi Tarteel', body: 'Un défi a été mis à jour.' },
    challenge_win: { title: 'Défi gagné !', body: 'Vous avez gagné un défi entre amis.' },
    challenge_complete: { title: 'Défi terminé', body: 'Vous avez terminé un défi entre amis.' },
    challenge_nudge: { title: 'Rappel défi', body: 'Un ami vous rappelle un défi.' },
    challenge_started: { title: 'Défi Tarteel', body: 'Ton défi commence. Bon courage !' },
    challenge_cancelled: { title: 'Défi Tarteel', body: 'Un défi a été annulé.' },
    friend_cheer: { title: 'Amis Tarteel', body: 'Un ami vous a encouragé.' },
  },
};

export const FRIEND_MESSAGES = friendsMessages;
export const friendMessages = friendsMessages;

export function getFriendMessage(type: string, lang: string = 'en'): FriendPushMessage {
  const locale = lang === 'fr' ? 'fr' : 'en';
  const dict = friendsMessages[locale] as Record<string, FriendPushMessage>;
  return dict[type] ?? friendsMessages[locale].friend_request;
}

export const FRIEND_PUSH_TYPES = Object.keys(friendsMessages.en) as FriendPushType[];

export default friendsMessages;

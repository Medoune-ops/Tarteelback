/**
 * Textes des notifications "amis" (ticket 0.B7).
 * Bilingues (fr / en). Un message par type, avec un titre et un corps.
 */

export type FriendPushType =
  | 'friend_request'
  | 'friend_accepted'
  | 'challenge_invite'
  | 'challenge_update'
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
    friend_cheer: { title: 'Tarteel Friends', body: 'A friend cheered you on.' },
  },
  fr: {
    friend_request: { title: 'Amis Tarteel', body: 'Quelqu\'un vous a envoyé une demande d\'amitié.' },
    friend_accepted: { title: 'Amis Tarteel', body: 'Votre demande d\'amitié a été acceptée.' },
    challenge_invite: { title: 'Défi Tarteel', body: 'Un ami vous a lancé un défi sur une Sourate.' },
    challenge_update: { title: 'Défi Tarteel', body: 'Un défi a été mis à jour.' },
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

import { describe, it, expect } from 'vitest';
import { sendMessageSchema } from '../src/modules/friends/friends.schemas.js';

/** Règle 2 : une réussite partagée doit référencer une sourate vérifiable. */
describe('friends send schema (règle 2)', () => {
  it('refuse une réussite sans sourate (numero)', () => {
    expect(sendMessageSchema.safeParse({ type: 'success' }).success).toBe(false);
    expect(sendMessageSchema.safeParse({ type: 'success', text: 'bravo' }).success).toBe(false);
  });

  it('accepte une réussite avec une sourate', () => {
    const r = sendMessageSchema.safeParse({ type: 'success', numero: 1, text: 'bravo' });
    expect(r.success).toBe(true);
  });

  it('ne change rien pour les autres types', () => {
    expect(sendMessageSchema.safeParse({ type: 'encouragement', text: 'go' }).success).toBe(true);
    expect(sendMessageSchema.safeParse({ type: 'encouragement' }).success).toBe(false);
    expect(sendMessageSchema.safeParse({ type: 'reminder', challengeId: 'c1' }).success).toBe(true);
    expect(sendMessageSchema.safeParse({ type: 'hadith', collectionId: 'x', n: 2 }).success).toBe(true);
  });
});

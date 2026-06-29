import { describe, it, expect } from 'vitest';
import { judgeStep } from '../src/core/lessonJudge.js';
import { applyXpMultiplier, isPremiumActive } from '../src/core/premium.js';

describe('lesson judge — discovery', () => {
  it('always passes and never risks a heart', () => {
    const j = judgeStep('discovery', { arabe: 'x', translitteration: '', traduction: '' }, {});
    expect(j).toEqual({ correct: true, heartAtStake: false });
  });
});

describe('lesson judge — written (QCM)', () => {
  const payload = {
    consigne: 'Que signifie ?',
    arabe: 'بِسْمِ',
    options: [
      { id: 'A', text: 'Au nom de' },
      { id: 'B', text: 'Allah' },
    ],
    bonneReponse: 'A',
  };

  it('passes on the correct option', () => {
    expect(judgeStep('written', payload, { optionId: 'A' })).toEqual({
      correct: true,
      heartAtStake: true,
    });
  });

  it('fails on a wrong option (heart at stake)', () => {
    expect(judgeStep('written', payload, { optionId: 'B' })).toEqual({
      correct: false,
      heartAtStake: true,
    });
  });
});

describe('lesson judge — voice (lenient threshold, never costs a heart)', () => {
  const payload = {
    arabe: 'x',
    translitteration: '',
    traduction: '',
    seuilReussite: 70,
  };

  it('passes at or above the threshold', () => {
    expect(judgeStep('voice', payload, { score: 70 }).correct).toBe(true);
    expect(judgeStep('voice', payload, { score: 95 }).correct).toBe(true);
  });

  it('fails below the threshold', () => {
    expect(judgeStep('voice', payload, { score: 69 }).correct).toBe(false);
    expect(judgeStep('voice', payload, {}).correct).toBe(false); // missing score => 0
  });

  it('never puts a heart at stake (client score is untrusted)', () => {
    expect(judgeStep('voice', payload, { score: 0 }).heartAtStake).toBe(false);
    expect(judgeStep('voice', payload, { score: 100 }).heartAtStake).toBe(false);
  });
});

describe('lesson judge — malformed payloads fail closed', () => {
  it('written without bonneReponse fails closed, no heart at stake', () => {
    const j = judgeStep('written', { options: [] }, { optionId: 'A' });
    expect(j).toEqual({ correct: false, heartAtStake: false });
  });

  it('null payload does not throw', () => {
    expect(() => judgeStep('written', null, { optionId: 'A' })).not.toThrow();
    expect(() => judgeStep('voice', null, { score: 80 })).not.toThrow();
  });
});

describe('premium', () => {
  it('doubles XP for premium, leaves free alone', () => {
    expect(applyXpMultiplier(10, true)).toBe(20);
    expect(applyXpMultiplier(10, false)).toBe(10);
  });

  it('is inactive when premiumUntil has passed', () => {
    const now = new Date('2026-06-27T00:00:00Z');
    expect(isPremiumActive({ isPremium: true, premiumUntil: new Date('2026-06-26T00:00:00Z') }, now)).toBe(false);
    expect(isPremiumActive({ isPremium: true, premiumUntil: new Date('2026-06-28T00:00:00Z') }, now)).toBe(true);
    expect(isPremiumActive({ isPremium: true, premiumUntil: null }, now)).toBe(true);
    expect(isPremiumActive({ isPremium: false, premiumUntil: null }, now)).toBe(false);
  });
});

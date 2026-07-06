import { describe, expect, it } from 'vitest';
import { normalizeArabic, scoreRecitation } from '../src/core/arabic.js';
import { judgeVoiceServer } from '../src/core/lessonJudge.js';

// Al-Fatiha 1:1, vocalisé (forme stockée en base) vs nu (forme "transcription").
const BASMALA_VOCALIZED = 'بِسْمِ اللَّهِ الرَّحْمَـٰنِ الرَّحِيمِ';
const BASMALA_BARE = 'بسم الله الرحمن الرحيم';

describe('normalizeArabic', () => {
  it('strips tashkil so vocalized and bare text collapse to the same form', () => {
    expect(normalizeArabic(BASMALA_VOCALIZED)).toBe(normalizeArabic(BASMALA_BARE));
  });

  it('unifies alef variants, ta marbuta and alef maqsura', () => {
    expect(normalizeArabic('أإآٱ')).toBe('اااا');
    expect(normalizeArabic('صلاة')).toBe(normalizeArabic('صلاه'));
    expect(normalizeArabic('هدى')).toBe(normalizeArabic('هدي'));
  });

  it('drops punctuation, digits, latin and collapses whitespace', () => {
    expect(normalizeArabic('  بسم   الله ـــ ۝ 12 abc! ')).toBe('بسم الله');
  });
});

describe('scoreRecitation', () => {
  it('gives 100 for a perfect recitation (modulo diacritics)', () => {
    expect(scoreRecitation(BASMALA_VOCALIZED, BASMALA_BARE)).toBe(100);
  });

  it('penalises a missing word but stays high', () => {
    const score = scoreRecitation(BASMALA_VOCALIZED, 'بسم الله الرحيم');
    expect(score).toBeGreaterThanOrEqual(70);
    expect(score).toBeLessThan(100);
  });

  it('barely penalises a near-miss word (one wrong letter)', () => {
    const score = scoreRecitation(BASMALA_VOCALIZED, 'بسم الله الرحمن الرحيب');
    expect(score).toBeGreaterThanOrEqual(90);
  });

  it('fails an unrelated recitation', () => {
    const score = scoreRecitation(BASMALA_VOCALIZED, 'قل هو الله احد');
    expect(score).toBeLessThan(70);
  });

  it('returns 0 for empty transcription or empty expected text', () => {
    expect(scoreRecitation(BASMALA_VOCALIZED, '')).toBe(0);
    expect(scoreRecitation('', BASMALA_BARE)).toBe(0);
    expect(scoreRecitation(BASMALA_VOCALIZED, 'hello world 123')).toBe(0);
  });
});

describe('judgeVoiceServer', () => {
  const payload = { arabe: BASMALA_VOCALIZED, seuilReussite: 70 };

  it('puts the heart at stake (server-computed score is trusted)', () => {
    expect(judgeVoiceServer(payload, 90)).toEqual({ correct: true, heartAtStake: true });
    expect(judgeVoiceServer(payload, 50)).toEqual({ correct: false, heartAtStake: true });
  });

  it('defaults the threshold to 70 on malformed payloads', () => {
    expect(judgeVoiceServer(null, 70).correct).toBe(true);
    expect(judgeVoiceServer(null, 69).correct).toBe(false);
  });
});

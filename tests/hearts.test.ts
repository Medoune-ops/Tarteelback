import { describe, it, expect } from 'vitest';
import {
  computeHearts,
  loseHeart,
  msUntilNextHeart,
  snapshot,
  MAX_HEARTS,
  HEART_REGEN_MS,
} from '../src/core/hearts.js';

const t0 = new Date('2026-01-01T00:00:00Z');
const at = (ms: number) => new Date(t0.getTime() + ms);

describe('hearts — loss', () => {
  it('loses one heart and anchors regen when full', () => {
    const s = loseHeart({ hearts: MAX_HEARTS, lastHeartLossAt: null }, false, t0);
    expect(s.hearts).toBe(MAX_HEARTS - 1);
    expect(s.lastHeartLossAt).toEqual(t0);
  });

  it('keeps the original anchor on subsequent losses', () => {
    const s = loseHeart({ hearts: 3, lastHeartLossAt: t0 }, false, at(1000));
    expect(s.hearts).toBe(2);
    expect(s.lastHeartLossAt).toEqual(t0); // anchor unchanged
  });

  it('never goes below zero', () => {
    const s = loseHeart({ hearts: 0, lastHeartLossAt: t0 }, false, at(10));
    expect(s.hearts).toBe(0);
  });

  it('premium never loses a heart', () => {
    const s = loseHeart({ hearts: 5, lastHeartLossAt: null }, true, t0);
    expect(s.hearts).toBe(MAX_HEARTS);
    expect(s.lastHeartLossAt).toBeNull();
  });
});

describe('hearts — regeneration (1 / 4h)', () => {
  it('regenerates exactly one heart after 4h', () => {
    const s = computeHearts({ hearts: 2, lastHeartLossAt: t0 }, false, at(HEART_REGEN_MS));
    expect(s.hearts).toBe(3);
    // anchor advanced by one interval
    expect(s.lastHeartLossAt).toEqual(at(HEART_REGEN_MS));
  });

  it('does not regenerate before 4h elapse', () => {
    const s = computeHearts({ hearts: 2, lastHeartLossAt: t0 }, false, at(HEART_REGEN_MS - 1));
    expect(s.hearts).toBe(2);
    expect(s.lastHeartLossAt).toEqual(t0);
  });

  it('regenerates multiple hearts over multiple intervals', () => {
    const s = computeHearts({ hearts: 1, lastHeartLossAt: t0 }, false, at(2 * HEART_REGEN_MS));
    expect(s.hearts).toBe(3);
  });

  it('caps at MAX and clears the anchor when full', () => {
    const s = computeHearts({ hearts: 1, lastHeartLossAt: t0 }, false, at(10 * HEART_REGEN_MS));
    expect(s.hearts).toBe(MAX_HEARTS);
    expect(s.lastHeartLossAt).toBeNull();
  });
});

describe('hearts — msUntilNextHeart', () => {
  it('returns remaining ms within the current interval', () => {
    const synced = computeHearts({ hearts: 2, lastHeartLossAt: t0 }, false, at(HEART_REGEN_MS / 2));
    const ms = msUntilNextHeart(synced, false, at(HEART_REGEN_MS / 2));
    expect(ms).toBe(HEART_REGEN_MS / 2);
  });

  it('is zero when full or premium', () => {
    expect(msUntilNextHeart({ hearts: MAX_HEARTS, lastHeartLossAt: null }, false)).toBe(0);
    expect(msUntilNextHeart({ hearts: 0, lastHeartLossAt: t0 }, true)).toBe(0);
  });
});

describe('hearts — snapshot', () => {
  it('flags outOfHearts for a blocked free user', () => {
    const snap = snapshot({ hearts: 0, lastHeartLossAt: t0 }, false, at(1000));
    expect(snap.outOfHearts).toBe(true);
    expect(snap.unlimited).toBe(false);
  });

  it('premium is always full and unlimited', () => {
    const snap = snapshot({ hearts: 0, lastHeartLossAt: t0 }, true, at(1000));
    expect(snap.hearts).toBe(MAX_HEARTS);
    expect(snap.outOfHearts).toBe(false);
    expect(snap.unlimited).toBe(true);
  });
});

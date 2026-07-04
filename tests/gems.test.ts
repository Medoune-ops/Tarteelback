import { describe, it, expect } from 'vitest';
import {
  promotionGems,
  isDoubleXpActive,
  GEM_LESSON_COMPLETE,
  GEM_LESSON_PERFECT,
  GEM_DAILY_STREAK,
  GEM_STREAK_MILESTONES,
  GEM_COST_HEART_REFILL,
  GEM_PACKS,
} from '../src/core/gems.js';

describe('gems — barèmes', () => {
  it('matches the spec earnings', () => {
    expect(GEM_LESSON_COMPLETE).toBe(10);
    expect(GEM_LESSON_PERFECT).toBe(20);
    expect(GEM_DAILY_STREAK).toBe(5);
    expect(GEM_STREAK_MILESTONES[7]).toBe(50);
    expect(GEM_STREAK_MILESTONES[30]).toBe(150);
  });

  it('promotion gems scale 100..500 by reached tier', () => {
    expect(promotionGems(2)).toBe(100);
    expect(promotionGems(5)).toBe(400);
    expect(promotionGems(1)).toBe(100); // floor
    expect(promotionGems(99)).toBe(500); // cap
  });

  it('a refill costs ~5 days of active free play (calibration)', () => {
    // ~70 gems/day for an active free player → 350 / 70 = 5 days.
    expect(GEM_COST_HEART_REFILL / 70).toBe(5);
  });

  it('packs match the spec pricing', () => {
    expect(GEM_PACKS.p500).toMatchObject({ gems: 500, priceEur: 0.99 });
    expect(GEM_PACKS.p3000).toMatchObject({ gems: 3000, priceEur: 4 });
    expect(GEM_PACKS.p7000).toMatchObject({ gems: 7000, priceEur: 7 });
  });
});

describe('gems — double XP boost', () => {
  it('is active only until the deadline', () => {
    const now = new Date('2026-07-04T12:00:00Z');
    expect(isDoubleXpActive(null, now)).toBe(false);
    expect(isDoubleXpActive(new Date('2026-07-04T12:10:00Z'), now)).toBe(true);
    expect(isDoubleXpActive(new Date('2026-07-04T11:59:00Z'), now)).toBe(false);
  });
});

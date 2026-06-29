import { describe, it, expect } from 'vitest';
import { streakReward, podiumReward, rollDailyChest, PODIUM_REWARD } from '../src/core/rewards.js';

describe('rewards — streak reward barème (mirrors front)', () => {
  it('matches the known tiers', () => {
    expect(streakReward(7)).toBe(100);
    expect(streakReward(14)).toBe(250);
    expect(streakReward(30)).toBe(600);
    expect(streakReward(50)).toBe(1200);
    expect(streakReward(100)).toBe(2500);
    expect(streakReward(365)).toBe(10000);
  });

  it('interpolates between tiers', () => {
    // halfway between 30 (600) and 50 (1200) → ~900
    expect(streakReward(40)).toBe(900);
  });

  it('handles edge cases', () => {
    expect(streakReward(0)).toBe(0);
    expect(streakReward(-5)).toBe(0);
    expect(streakReward(1000)).toBeGreaterThan(10000); // beyond last tier
  });
});

describe('rewards — podium', () => {
  it('pays 500/300/150 for ranks 1/2/3', () => {
    expect(podiumReward(1)).toBe(500);
    expect(podiumReward(2)).toBe(300);
    expect(podiumReward(3)).toBe(150);
    expect(podiumReward(4)).toBe(0);
    expect(PODIUM_REWARD[1]).toBe(500);
  });
});

describe('rewards — daily chest', () => {
  it('returns a reward from the pool', () => {
    const r = rollDailyChest(() => 0); // first element
    expect(r).toEqual({ type: 'xp', amount: 10 });
    const last = rollDailyChest(() => 0.99); // last element
    expect(last).toEqual({ type: 'hearts', amount: 2 });
  });
});

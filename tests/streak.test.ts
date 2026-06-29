import { describe, it, expect } from 'vitest';
import {
  applyActivity,
  refreshStreak,
  repairStreak,
  localDayKey,
  type StreakState,
} from '../src/core/streak.js';

const TZ = 'Africa/Dakar'; // UTC+0, no DST — simple reasoning
const day = (d: string) => new Date(`${d}T12:00:00Z`);

const base: StreakState = {
  streak: 5,
  streakFrozen: false,
  lastStreakValue: 0,
  lastActivityDate: day('2026-01-10'),
};

describe('streak — localDayKey', () => {
  it('formats the local calendar day', () => {
    expect(localDayKey(day('2026-01-10'), TZ)).toBe('2026-01-10');
  });

  it('respects timezone across midnight', () => {
    // 23:30 UTC on the 10th is already the 11th in UTC+2.
    const d = new Date('2026-01-10T23:30:00Z');
    expect(localDayKey(d, 'Asia/Riyadh')).toBe('2026-01-11'); // UTC+3
  });
});

describe('streak — refresh (freeze / break)', () => {
  it('stays active the same day', () => {
    const s = refreshStreak(base, TZ, day('2026-01-10'));
    expect(s.streak).toBe(5);
    expect(s.streakFrozen).toBe(false);
  });

  it('freezes after 1 missed day', () => {
    const s = refreshStreak(base, TZ, day('2026-01-11'));
    expect(s.streak).toBe(5);
    expect(s.streakFrozen).toBe(true);
  });

  it('breaks after 2 missed days, snapshotting the value', () => {
    const s = refreshStreak(base, TZ, day('2026-01-12'));
    expect(s.streak).toBe(0);
    expect(s.streakFrozen).toBe(false);
    expect(s.lastStreakValue).toBe(5);
  });
});

describe('streak — activity', () => {
  it('increments once per day', () => {
    const s = applyActivity(base, TZ, day('2026-01-11'));
    expect(s.streak).toBe(6);
    // a second activity the same day does not double-count
    const s2 = applyActivity(s, TZ, day('2026-01-11'));
    expect(s2.streak).toBe(6);
  });

  it('does not increment twice in the same local day', () => {
    const s = applyActivity({ ...base, lastActivityDate: day('2026-01-10') }, TZ, day('2026-01-10'));
    expect(s.streak).toBe(5);
  });

  it('restarts at 1 after a break', () => {
    const broken = refreshStreak(base, TZ, day('2026-01-13')); // broken -> 0
    expect(broken.streak).toBe(0);
    const resumed = applyActivity(broken, TZ, day('2026-01-13'));
    expect(resumed.streak).toBe(1);
    expect(resumed.lastStreakValue).toBe(5); // still remembers for paid repair
  });
});

describe('streak — paid repair', () => {
  it('restores the snapshotted value', () => {
    const broken = refreshStreak(base, TZ, day('2026-01-13'));
    const repaired = repairStreak(broken);
    expect(repaired.streak).toBe(5);
    expect(repaired.streakFrozen).toBe(false);
  });

  it('is a no-op when there is nothing to repair', () => {
    const s = repairStreak({ streak: 3, streakFrozen: false, lastStreakValue: 0, lastActivityDate: null });
    expect(s.streak).toBe(3);
  });
});

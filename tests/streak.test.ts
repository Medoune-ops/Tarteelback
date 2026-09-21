import { describe, it, expect } from 'vitest';
import {
  applyActivity,
  refreshStreak,
  settleStreak,
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

describe('streak — freeze items', () => {
  it('one freeze protects the second missed day', () => {
    // Last activity Jan 10, now Jan 12 → 1 grace day + 1 day needing a freeze.
    const r = settleStreak(base, TZ, day('2026-01-12'), 1);
    expect(r.state.streak).toBe(5);
    expect(r.state.streakFrozen).toBe(true);
    expect(r.freezesConsumed).toBe(1);
  });

  it('settles the anchor so freezes are not re-consumed on the next sync', () => {
    const r = settleStreak(base, TZ, day('2026-01-12'), 1);
    const again = settleStreak(r.state, TZ, day('2026-01-12'), 0);
    expect(again.state.streak).toBe(5);
    expect(again.freezesConsumed).toBe(0);
  });

  it('breaks when there are not enough freezes', () => {
    // 3 missed days beyond the grace → needs 3, only 1 held.
    const r = settleStreak(base, TZ, day('2026-01-14'), 1);
    expect(r.state.streak).toBe(0);
    expect(r.state.lastStreakValue).toBe(5);
    expect(r.freezesConsumed).toBe(0);
  });

  it('unlimited freezes (Plus) always protect', () => {
    const r = settleStreak(base, TZ, day('2026-01-20'), Number.POSITIVE_INFINITY);
    expect(r.state.streak).toBe(5);
  });

  it('a protected day still allows the streak to increment today', () => {
    const s = applyActivity(base, TZ, day('2026-01-12'), 1);
    expect(s.streak).toBe(6);
    expect(s.freezesConsumed).toBe(1);
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

  it('consomme le snapshot : plus rien à racheter après la restauration', () => {
    const broken = refreshStreak(base, TZ, day('2026-01-13'));
    const repaired = repairStreak(broken);
    expect(repaired.streak).toBe(5);
    // Sinon l'écran Série reproposerait « restaurer 5 jours » indéfiniment.
    expect(repaired.lastStreakValue).toBe(0);
  });
});

/**
 * L'écran Série lit `lastStreakValue` pour annoncer ce que la restauration
 * payante rendrait. Il doit toujours refléter la PLUS LONGUE série perdue :
 * revenir 2 jours après avoir cassé 30 jours ne doit pas ramener l'offre à 2.
 */
describe('streak — mémoire de la plus longue série perdue', () => {
  it('une reprise courte cassée n’écrase pas la longue série perdue', () => {
    const long: StreakState = {
      streak: 30,
      streakFrozen: false,
      lastStreakValue: 0,
      lastActivityDate: day('2026-01-10'),
    };
    const casse = refreshStreak(long, TZ, day('2026-01-13'));
    expect(casse.lastStreakValue).toBe(30);

    // L'utilisateur revient, fait une leçon : la série repart à 1.
    const reprise = applyActivity(casse, TZ, day('2026-01-14'));
    expect(reprise.streak).toBe(1);
    expect(reprise.lastStreakValue).toBe(30);

    // Puis il recasse cette reprise de 1 jour.
    const recasse = refreshStreak(reprise, TZ, day('2026-01-17'));
    expect(recasse.streak).toBe(0);
    expect(recasse.lastStreakValue).toBe(30); // et non 1
  });

  it('une reprise PLUS longue que la précédente met bien à jour le snapshot', () => {
    const state: StreakState = {
      streak: 12,
      streakFrozen: false,
      lastStreakValue: 4,
      lastActivityDate: day('2026-01-10'),
    };
    const casse = refreshStreak(state, TZ, day('2026-01-13'));
    expect(casse.lastStreakValue).toBe(12);
  });
});

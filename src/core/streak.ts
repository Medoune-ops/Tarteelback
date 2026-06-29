/**
 * Streak (flame) mechanics — pure, timezone-aware, server-authoritative.
 *
 * Rules:
 *  - +1 when the user completes ≥1 lesson during their local day.
 *  - 1 local day with no activity  -> frozen (not lost).
 *  - 2 local days with no activity -> broken: snapshot into lastStreakValue,
 *    streak=0, frozen=false.
 *  - Resuming after a break -> streak restarts at 1.
 *  - Paid repair restores streak = lastStreakValue.
 *
 * "Local day" is derived from the user's IANA timezone. We never trust a
 * client-sent date; callers pass `now` (UTC) and the user's timezone.
 */

export interface StreakState {
  streak: number;
  streakFrozen: boolean;
  lastStreakValue: number;
  /** Date (any time) of the last completed activity, or null if never. */
  lastActivityDate: Date | null;
}

/**
 * Return YYYY-MM-DD for `date` in the given IANA timezone. Used to compare
 * "which local day" two instants fall on, independent of server timezone.
 */
/** True if `tz` is a valid IANA timezone accepted by Intl. */
export function isValidTimezone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-CA', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export function localDayKey(date: Date, timezone: string): string {
  // Defensive: never throw on a bad timezone (would otherwise 500 every
  // /me, streak refresh and lesson complete). Fall back to UTC.
  const tz = isValidTimezone(timezone) ? timezone : 'UTC';
  // en-CA gives ISO-like YYYY-MM-DD formatting.
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  return fmt.format(date);
}

/** Number of whole local days between two day keys (b - a). */
function dayDiff(aKey: string, bKey: string): number {
  // Day keys are calendar dates; parse as UTC midnight to diff safely.
  const a = Date.parse(`${aKey}T00:00:00Z`);
  const b = Date.parse(`${bKey}T00:00:00Z`);
  return Math.round((b - a) / (24 * 60 * 60 * 1000));
}

/**
 * Recompute streak freshness when the app opens (no activity happening now).
 * Applies freeze after 1 missed day and break after ≥2 missed days.
 */
export function refreshStreak(
  state: StreakState,
  timezone: string,
  now: Date = new Date(),
): StreakState {
  if (state.lastActivityDate == null || state.streak === 0) {
    return state;
  }
  const lastKey = localDayKey(state.lastActivityDate, timezone);
  const nowKey = localDayKey(now, timezone);
  const diff = dayDiff(lastKey, nowKey);

  if (diff <= 0) return { ...state, streakFrozen: false }; // active today
  if (diff === 1) return { ...state, streakFrozen: true }; // one day missed -> frozen
  // Two or more missed days -> broken.
  return {
    streak: 0,
    streakFrozen: false,
    lastStreakValue: state.streak,
    lastActivityDate: state.lastActivityDate,
  };
}

/**
 * Apply a completed activity (≥1 lesson done) "now". Increments at most once
 * per local day. Resuming after a break restarts at 1.
 */
export function applyActivity(
  state: StreakState,
  timezone: string,
  now: Date = new Date(),
): StreakState {
  const nowKey = localDayKey(now, timezone);

  // First refresh to settle any pending freeze/break.
  const refreshed = refreshStreak(state, timezone, now);

  if (refreshed.lastActivityDate != null) {
    const lastKey = localDayKey(refreshed.lastActivityDate, timezone);
    if (lastKey === nowKey && refreshed.streak > 0) {
      // Already counted today; just ensure not frozen.
      return { ...refreshed, streakFrozen: false, lastActivityDate: now };
    }
  }

  const newStreak = refreshed.streak === 0 ? 1 : refreshed.streak + 1;
  return {
    streak: newStreak,
    streakFrozen: false,
    lastStreakValue: refreshed.lastStreakValue,
    lastActivityDate: now,
  };
}

/**
 * Paid restoration: bring back the streak captured before the break. We also
 * set `lastActivityDate = now` and clear the freeze, otherwise the very next
 * `refreshStreak` would see ≥2 missed days and immediately re-break the streak
 * the user just paid to recover.
 */
export function repairStreak(state: StreakState, now: Date = new Date()): StreakState {
  if (state.lastStreakValue <= 0) return state;
  return {
    ...state,
    streak: state.lastStreakValue,
    streakFrozen: false,
    lastActivityDate: now,
  };
}

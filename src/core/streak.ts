/**
 * Streak (flame) mechanics — pure, timezone-aware, server-authoritative.
 *
 * Rules:
 *  - +1 when the user completes ≥1 lesson during their local day.
 *  - 1 local day with no activity  -> frozen (not lost) — free grace day.
 *  - Each FURTHER missed day consumes one streak-freeze item (bought with
 *    gems; unlimited for Plus). When the freezes cover every extra missed day
 *    the streak survives; otherwise it breaks: snapshot into lastStreakValue,
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

export interface StreakSettle {
  state: StreakState;
  /**
   * How many streak-freeze items this settle consumed. Meaningful only for
   * free users (pass `Infinity` for Plus and ignore the count — their freezes
   * are unlimited and no inventory is decremented).
   */
  freezesConsumed: number;
}

/**
 * Recompute streak freshness when the app opens (no activity happening now).
 * The first missed day is a free grace (frozen). Each extra missed day needs
 * one streak-freeze item; when `freezesAvailable` covers them all the streak
 * survives, otherwise it breaks (snapshot into lastStreakValue).
 */
export function settleStreak(
  state: StreakState,
  timezone: string,
  now: Date = new Date(),
  freezesAvailable = 0,
): StreakSettle {
  if (state.lastActivityDate == null || state.streak === 0) {
    return { state, freezesConsumed: 0 };
  }
  const lastKey = localDayKey(state.lastActivityDate, timezone);
  const nowKey = localDayKey(now, timezone);
  const diff = dayDiff(lastKey, nowKey);

  if (diff <= 0) return { state: { ...state, streakFrozen: false }, freezesConsumed: 0 };
  if (diff === 1) return { state: { ...state, streakFrozen: true }, freezesConsumed: 0 };

  // ≥2 missed local days: the grace day is free, each further day needs a freeze.
  const needed = diff - 1;
  if (freezesAvailable >= needed) {
    // Protected. Anchor the activity date on YESTERDAY (local) so the state
    // settles into the plain "frozen grace day" case: future settles stop
    // re-counting (and re-consuming), and a lesson today still increments.
    return {
      state: {
        ...state,
        streakFrozen: true,
        lastActivityDate: new Date(now.getTime() - 24 * 60 * 60 * 1000),
      },
      freezesConsumed: needed,
    };
  }
  // Not enough freezes -> broken (paid repair can still restore it).
  return {
    state: {
      streak: 0,
      streakFrozen: false,
      lastStreakValue: state.streak,
      lastActivityDate: state.lastActivityDate,
    },
    freezesConsumed: 0,
  };
}

/** `settleStreak` without any freeze items (legacy shape, state only). */
export function refreshStreak(
  state: StreakState,
  timezone: string,
  now: Date = new Date(),
): StreakState {
  return settleStreak(state, timezone, now, 0).state;
}

/**
 * Apply a completed activity (≥1 lesson done) "now". Increments at most once
 * per local day. Resuming after a break restarts at 1. Pending missed days are
 * settled first, consuming freezes when available (Infinity for Plus).
 */
export function applyActivity(
  state: StreakState,
  timezone: string,
  now: Date = new Date(),
  freezesAvailable = 0,
): StreakState & { freezesConsumed: number } {
  const nowKey = localDayKey(now, timezone);

  // First settle any pending freeze/break (may consume freeze items).
  const { state: refreshed, freezesConsumed } = settleStreak(
    state,
    timezone,
    now,
    freezesAvailable,
  );

  if (refreshed.lastActivityDate != null) {
    const lastKey = localDayKey(refreshed.lastActivityDate, timezone);
    if (lastKey === nowKey && refreshed.streak > 0) {
      // Already counted today; just ensure not frozen.
      return { ...refreshed, streakFrozen: false, lastActivityDate: now, freezesConsumed };
    }
  }

  const newStreak = refreshed.streak === 0 ? 1 : refreshed.streak + 1;
  return {
    streak: newStreak,
    streakFrozen: false,
    lastStreakValue: refreshed.lastStreakValue,
    lastActivityDate: now,
    freezesConsumed,
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

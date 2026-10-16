import { z } from 'zod';
import { now as injectedNow } from './clock.js';

export type ChallengeType = 'streak' | 'sourates';
export type ChallengeStatus = 'pending' | 'active' | 'completed' | 'cancelled';
export const CHALLENGE_TYPES_LIST = ['streak', 'sourates'] as const;

export const MIN_STREAK_DAYS = 3;
export const MAX_STREAK_DAYS = 100;
export const MIN_SOURATES = 1;
export const MAX_SOURATES = 30;
export const MAX_STREAK_DURATION_DAYS = 1000; // borne de sanity ; aucune limite métier sur la durée (D-F).

// --------------------------------------------------------------------------- goals
const streakGoalSchema = z.union([
  z.object({ type: z.literal('streak').optional(), kind: z.literal('streak').optional(), metric: z.literal('streak').optional(), days: z.number().int().min(MIN_STREAK_DAYS).max(MAX_STREAK_DAYS) }),
  z.object({ type: z.literal('streak').optional(), kind: z.literal('streak').optional(), metric: z.literal('streak').optional(), targetDays: z.number().int().min(MIN_STREAK_DAYS).max(MAX_STREAK_DAYS) }),
  z.object({ days: z.number().int().min(MIN_STREAK_DAYS).max(MAX_STREAK_DAYS) }),
  z.object({ targetDays: z.number().int().min(MIN_STREAK_DAYS).max(MAX_STREAK_DAYS) }),
]);

const sourateNumber = z.number().int().min(1).max(114);

const souratesGoalSchema = z.union([
  z.object({ type: z.literal('sourates').optional(), kind: z.literal('sourates').optional(), metric: z.literal('sourates').optional(), sourateNumeros: z.array(sourateNumber).min(MIN_SOURATES).max(MAX_SOURATES) }),
  z.object({ type: z.literal('sourates').optional(), kind: z.literal('sourates').optional(), metric: z.literal('sourates').optional(), numeros: z.array(sourateNumber).min(MIN_SOURATES).max(MAX_SOURATES) }),
  z.object({ type: z.literal('sourates').optional(), kind: z.literal('sourates').optional(), metric: z.literal('sourates').optional(), from: z.number().int().min(1).max(114), to: z.number().int().min(1).max(114) }),
  z.object({ sourateNumeros: z.array(sourateNumber).min(MIN_SOURATES).max(MAX_SOURATES) }),
  z.object({ numeros: z.array(sourateNumber).min(MIN_SOURATES).max(MAX_SOURATES) }),
  z.object({ from: z.number().int().min(1).max(114), to: z.number().int().min(1).max(114) }),
]);

export type StreakGoal = { type: 'streak'; days: number };
export type SouratesGoal = { type: 'sourates'; sourateNumeros: number[] };

export function normalizeStreakGoal(goal: unknown): number {
  if (!goal || typeof goal !== 'object') return NaN;
  const g = goal as Record<string, unknown>;
  const n = g.days ?? g.targetDays ?? g.target ?? g.goal;
  return typeof n === 'number' ? n : Number(n);
}

export function expandRange(from: number, to: number): number[] {
  const lo = Math.min(from, to);
  const hi = Math.max(from, to);
  const out: number[] = [];
  for (let n = lo; n <= hi && out.length < MAX_SOURATES; n++) out.push(n);
  return out.slice(0, MAX_SOURATES);
}

export function normalizeSouratesGoal(goal: unknown): number[] {
  if (!goal || typeof goal !== 'object') return [];
  const g = goal as Record<string, unknown>;
  let nums: number[] = [];
  if (Array.isArray(g.sourateNumeros)) nums = [...g.sourateNumeros];
  else if (Array.isArray(g.numeros)) nums = [...g.numeros];
  else if (Array.isArray(g.sourates)) nums = [...g.sourates];
  else if (typeof g.from === 'number' && typeof g.to === 'number') nums = expandRange(g.from, g.to);
  // dédup + validation + limite
  const set = new Set<number>();
  for (const n of nums) if (Number.isInteger(n) && n >= 1 && n <= 114) set.add(n);
  return [...set].sort((a, b) => a - b).slice(0, MAX_SOURATES);
}

export function kindOf(goal: unknown): ChallengeType | null {
  if (!goal || typeof goal !== 'object') return null;
  const g = goal as Record<string, unknown>;
  const t = g.type ?? g.kind ?? g.metric ?? (Array.isArray(g.sourateNumeros) || Array.isArray(g.numeros) || (typeof g.from === 'number' && typeof g.to === 'number') ? 'sourates' : (g.days != null || g.targetDays != null ? 'streak' : null));
  if (t === 'streak' || t === 'sourates') return t;
  return null;
}

// --------------------------------------------------------------------------- streak progress
export function nextDayKey(key: string): string {
  const d = new Date(`${key}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

function inRange(key: string, start?: string, end?: string): boolean {
  if (start && key < start) return false;
  if (end && key > end) return false;
  return true;
}

export function longestStreakInWindow(
  days: string[],
  startDay?: string,
  endDay?: string,
): number {
  const ranged = Array.from(new Set(days.filter((d) => inRange(d, startDay, endDay))));
  ranged.sort();
  let best = 0;
  let cur = 0;
  let prev: string | null = null;
  for (const day of ranged) {
    if (prev && day === nextDayKey(prev)) cur += 1;
    else cur = 1;
    if (cur > best) best = cur;
    prev = day;
  }
  return best;
}

export function streakProgress(...args: any[]): number {
  // accepte objet ou positionnel
  let days: string[] = [];
  let startDay: string | undefined;
  let endDay: string | undefined;
  if (Array.isArray(args[0])) {
    days = args[0] as string[];
    startDay = args[1];
    endDay = args[2];
  } else if (args[0] && typeof args[0] === 'object') {
    const o = args[0] as Record<string, unknown>;
    days = (o.days ?? o.activityDays ?? o.keys ?? []) as string[];
    startDay = (o.startDay ?? o.start ?? o.min) as string | undefined;
    endDay = (o.endDay ?? o.end ?? o.max) as string | undefined;
  }
  return longestStreakInWindow(days, startDay, endDay);
}

// --------------------------------------------------------------------------- sourates progress
export interface SourateLessonProgress {
  numero: number;
  allLessonsCompleted: boolean;
  completedAt: Date | string | null; // dernière leçon complétée
}

export function sourateProgressCount(input: {
  goal: unknown;
  baseline: number[];
  completed: SourateLessonProgress[];
  startedAt: Date | string;
  now?: Date | string;
}): number {
  const wanted = new Set(normalizeSouratesGoal(input.goal));
  const baseline = new Set(input.baseline ?? []);
  const started = input.startedAt instanceof Date ? input.startedAt.getTime() : new Date(input.startedAt).getTime();
  const nowTs = input.now ? (input.now instanceof Date ? input.now.getTime() : new Date(input.now).getTime()) : injectedNow().getTime();
  if (nowTs < started) return 0;
  let count = 0;
  for (const sp of wanted) {
    if (baseline.has(sp)) continue;
    const entry = (input.completed ?? []).find((c) => c.numero === sp);
    if (!entry || !entry.allLessonsCompleted) continue;
    if (!entry.completedAt) continue;
    const doneTs = entry.completedAt instanceof Date ? entry.completedAt.getTime() : new Date(entry.completedAt).getTime();
    if (doneTs > started) count += 1;
  }
  return count;
}

export function isSouratesReached(progress: number, goal: unknown): boolean {
  const wanted = normalizeSouratesGoal(goal);
  return wanted.length > 0 && progress >= wanted.length;
}

// --------------------------------------------------------------------------- computeProgress pour registre
function argDays(args: unknown[]): string[] {
  const a = args[0];
  if (Array.isArray(a)) return a as string[];
  if (a && typeof a === 'object') {
    const o = a as Record<string, unknown>;
    if (Array.isArray(o.days)) return o.days as string[];
    if (Array.isArray(o.activityDays)) return o.activityDays as string[];
  }
  return [];
}
function argStart(args: unknown[]): string | undefined {
  const a = args[0];
  if (a && typeof a === 'object' && !Array.isArray(a)) {
    const o = a as Record<string, unknown>;
    return (o.startDay ?? o.start ?? o.min) as string | undefined;
  }
  return args[1] as string | undefined;
}
function argEnd(args: unknown[]): string | undefined {
  const a = args[0];
  if (a && typeof a === 'object' && !Array.isArray(a)) {
    const o = a as Record<string, unknown>;
    return (o.endDay ?? o.end ?? o.max) as string | undefined;
  }
  return args[2] as string | undefined;
}

// --------------------------------------------------------------------------- registry
export interface RegistryEntry {
  goalSchema: z.ZodTypeAny;
  computeProgress: (...args: any[]) => number;
  isReached: (progress: number, goal?: unknown) => boolean;
}

export const CHALLENGE_TYPES: Record<ChallengeType, RegistryEntry> = {
  streak: {
    goalSchema: streakGoalSchema,
    computeProgress: (...args: any[]) => streakProgress(...args),
    isReached: (progress, goal) => {
      const n = normalizeStreakGoal(goal);
      return Number.isFinite(n) && progress >= n;
    },
  },
  sourates: {
    goalSchema: souratesGoalSchema,
    computeProgress: (...args: any[]) => {
      // supporte either goal object or positional
      if (args.length === 1 && args[0] && typeof args[0] === 'object' && !Array.isArray(args[0])) {
        const o = args[0] as Record<string, unknown>;
        if ('baseline' in o || 'completed' in o || 'completedLessons' in o) {
          return sourateProgressCount({
            goal: o.goal,
            baseline: (o.baseline ?? []) as number[],
            completed: (o.completed ?? o.completedLessons ?? []) as SourateLessonProgress[],
            startedAt: (o.startedAt ?? o.startsAt ?? new Date()) as any,
            now: o.now as any,          });
        }
      }
      // fallback : compte de sourates validées passées en tableau
      const arr = Array.isArray(args[0]) ? (args[0] as number[]) : [];
      return arr.length;
    },
    isReached: (progress, goal) => isSouratesReached(progress, goal),
  },
};

export const challengeTypes = CHALLENGE_TYPES;
export const CHALLENGE_TYPE_REGISTRY = CHALLENGE_TYPES;

// exports alias pour les tests dont on ne connaît pas le nom exact
export const computeStreakProgress = streakProgress;
export const souratesProgress = sourateProgressCount;
export const computeSouratesProgress = sourateProgressCount;

// --------------------------------------------------------------------------- transition
export type EventLike = {
  type?: string;
  name?: string;
  now?: Date | string;
  date?: Date | string;
  startsAt?: Date | string;
  endsAt?: Date | string;
  acceptedCount?: number;
  accepted?: number;
  cancelled?: boolean;
  reached?: boolean;
  progress?: number;
};

export type ChallengeLikeForTransition = {
  status?: string;
  startsAt?: Date | string;
  endsAt?: Date | string;
  acceptedCount?: number;
};

export function toTime(v: unknown): number {
  if (v instanceof Date) return v.getTime();
  if (typeof v === 'string' || typeof v === 'number') return new Date(v).getTime();
  return (injectedNow ? injectedNow() : new Date()).getTime();
}

export function transition(
  state: string | ChallengeLikeForTransition,
  event?: string | EventLike,
  extra?: Record<string, unknown>,
): ChallengeStatus {
  const status = (typeof state === 'string' ? state : (state?.status ?? 'pending')) as ChallengeStatus;
  const ev: EventLike = typeof event === 'string' ? { type: event, ...(extra ?? {}) } : (event ?? {});
  const type = ev.type ?? ev.name ?? '';
  const now = toTime(ev.now ?? ev.date ?? undefined);
  const startsAt = ev.startsAt ?? (typeof state === 'object' ? state?.startsAt : undefined);
  const endsAt = ev.endsAt ?? (typeof state === 'object' ? state?.endsAt : undefined);
  const acceptedCount = (ev.acceptedCount ?? ev.accepted ?? (typeof state === 'object' ? state?.acceptedCount : 0) ?? 0) as number;

  if (status === 'pending') {
    if (type === 'cancel' || ev.cancelled) return 'cancelled';
    if (startsAt != null) {
      const st = toTime(startsAt);
      if (now >= st) {
        return acceptedCount >= 2 ? 'active' : 'cancelled';
      }
    }
    return 'pending';
  }
  if (status === 'active') {
    if (type === 'cancel' || ev.cancelled) return 'cancelled';
    if (type === 'complete' || type === 'reach' || ev.reached) return 'completed';
    if (endsAt != null && now >= toTime(endsAt)) return 'completed';
    return 'active';
  }
  return status;
}

export const nextStatus = transition;

// --------------------------------------------------------------------------- winners
export interface ParticipantForWinner {
  id?: string;
  userId?: string;
  progress?: number;
  target?: number;
  reached?: boolean;
  reachedAt?: Date | string | null;
  rank?: number | null;
  rewardGems?: number;
}

function participantId(p: ParticipantForWinner): string {
  return String(p.userId ?? p.id ?? '');
}

function isReachedParticipant(p: ParticipantForWinner): boolean {
  if (typeof p.reached === 'boolean') return p.reached;
  const target = p.target ?? 0;
  const progress = p.progress ?? 0;
  return target > 0 && progress >= target;
}

export function determineWinners(participants: ParticipantForWinner[] = []): string[] {
  if (!Array.isArray(participants) || participants.length === 0) return [];
  const reached = participants.filter(isReachedParticipant);
  if (reached.length > 0) {
    const times = reached.map((p) => (p.reachedAt ? toTime(p.reachedAt) : Number.POSITIVE_INFINITY));
    const minTime = Math.min(...times);
    const winners = reached.filter((p, i) => times[i] === minTime).map(participantId).filter(Boolean);
    if (winners.length > 0) return [...new Set(winners)];
  }
  // aucun n'a atteint : meilleure progression
  const maxProgress = Math.max(...participants.map((p) => p.progress ?? 0));
  const tops = participants.filter((p) => (p.progress ?? 0) === maxProgress).map(participantId).filter(Boolean);
  return [...new Set(tops)];
}

export const resolveWinners = determineWinners;
export const getWinners = determineWinners;
export const pickWinner = (participants: ParticipantForWinner[] = []) => determineWinners(participants)[0] ?? null;
export const winnerOf = pickWinner;

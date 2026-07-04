import { prisma } from '../../config/prisma.js';
import { AppError } from '../../core/errors.js';
import { isPremiumActive, applyXpMultiplier } from '../../core/premium.js';
import { computeHearts, snapshot, MAX_HEARTS } from '../../core/hearts.js';
import { applyActivity, localDayKey } from '../../core/streak.js';
import {
  GEM_LESSON_COMPLETE,
  GEM_LESSON_PERFECT,
  GEM_DAILY_STREAK,
  GEM_STREAK_MILESTONES,
  DOUBLE_XP_MULTIPLIER,
  isDoubleXpActive,
} from '../../core/gems.js';
import { judgeStep, type AnswerInput, type StepType } from '../../core/lessonJudge.js';
import { userRepository } from '../me/user.repository.js';
import { leagueService } from '../leagues/league.service.js';
import { lessonRepository } from './lesson.repository.js';
import { computeUserStats } from '../me/user.stats.js';
import { serializeUserFlat } from '../me/user.serializer.js';

/**
 * Lesson XP formula — mirrors the front (`play.tsx`): a flat base plus a bonus
 * per correctly answered test step. The server bounds `correctCount` to the
 * lesson's actual number of test steps so a client can't inflate it.
 */
const LESSON_XP_BASE = 15;
const LESSON_XP_PER_CORRECT = 2;

function lessonXp(correctCount: number, testStepCount: number): number {
  const safeCorrect = Math.max(0, Math.min(correctCount, testStepCount));
  return LESSON_XP_BASE + safeCorrect * LESSON_XP_PER_CORRECT;
}

export const lessonService = {
  /**
   * Judge one submitted answer. Server-authoritative:
   *  - blocks a free user who is already out of hearts (OUT_OF_HEARTS);
   *  - on a wrong answer to a test step (written/voice), deducts one heart
   *    (no-op for premium);
   *  - discovery never costs a heart.
   */
  async answer(userId: string, lessonId: string, stepId: string, body: AnswerInput) {
    const now = new Date();
    const user = await userRepository.getOrThrow(userId);
    const premium = isPremiumActive(user, now);

    // 1) Settle time-based regeneration first (idempotent write).
    const synced = computeHearts(
      { hearts: user.hearts, lastHeartLossAt: user.lastHeartLossAt },
      premium,
      now,
    );
    if (
      synced.hearts !== user.hearts ||
      synced.lastHeartLossAt?.getTime() !== user.lastHeartLossAt?.getTime()
    ) {
      await userRepository.update(userId, {
        hearts: synced.hearts,
        lastHeartLossAt: synced.lastHeartLossAt,
      });
    }

    // A blocked free user cannot act at all.
    if (!premium && synced.hearts <= 0) {
      throw new AppError('OUT_OF_HEARTS', 'You have no hearts left');
    }

    const step = await lessonRepository.getStep(stepId);
    if (!step || step.lessonId !== lessonId) {
      throw new AppError('NOT_FOUND', 'Step not found in this lesson');
    }

    const judgement = judgeStep(step.type as StepType, step.payload, body as AnswerInput);

    // 2) On a wrong test answer, deduct a heart ATOMICALLY and conditionally.
    //    `updateMany ... WHERE hearts > 0 SET hearts = hearts - 1` is a single
    //    SQL statement → no read-modify-write race (two concurrent wrong
    //    answers each remove exactly one heart, never "lose" a decrement).
    let heartsState = synced;
    if (!judgement.correct && judgement.heartAtStake && !premium) {
      const wasFull = synced.hearts >= MAX_HEARTS;
      const res = await lessonRepository.decrementHeart(userId, wasFull ? now : null);
      if (res.count > 0) {
        // Re-read the authoritative value after the atomic decrement.
        const fresh = await userRepository.getOrThrow(userId);
        heartsState = { hearts: fresh.hearts, lastHeartLossAt: fresh.lastHeartLossAt };
      }
    }

    // After judging, it's safe to reveal the correct option id so the front can
    // highlight it (green) — the user has already answered. Only for `written`.
    let bonneReponse: string | undefined;
    if (step.type === 'written') {
      const p = step.payload as { bonneReponse?: unknown };
      if (typeof p?.bonneReponse === 'string') bonneReponse = p.bonneReponse;
    }

    const snap = snapshot(heartsState, premium, now);
    return {
      correct: judgement.correct,
      bonneReponse, // correct option id (written only), revealed post-answer
      heartsLeft: snap.hearts,
      outOfHearts: snap.outOfHearts,
      unlimited: snap.unlimited,
      msUntilNextHeart: snap.msUntilNextHeart,
    };
  },

  /**
   * Complete a lesson. IDEMPOTENT and anti-farm:
   *  - XP/weeklyXp/streak/league are credited ONLY on the FIRST completion of a
   *    given lesson. Replaying `complete` (double-tap, retry, malicious loop)
   *    yields `xpGained: 0` and changes nothing — no XP/streak/league farming.
   *  - The whole mutation runs in one transaction; the league XP is added in
   *    the same transaction so the two weekly counters can't diverge.
   *  - State is re-read INSIDE the transaction so concurrent completes can't
   *    both see "not completed" and double-credit (the unique upsert + the
   *    first-completion read make it safe).
   */
  async complete(userId: string, lessonId: string, correctCount?: number, score?: number) {
    const now = new Date();

    const lesson = await lessonRepository.getLessonWithSteps(lessonId);
    if (!lesson) throw new AppError('NOT_FOUND', 'Lesson not found');

    // Number of server-judged test steps — matching is client-only, ordering counts.
    const testStepCount = lesson.steps.filter((s) => s.type !== 'discovery' && s.type !== 'matching').length;

    const result = await prisma.$transaction(async (tx) => {
      // Lock the user row for the duration so streak/XP updates are consistent
      // under concurrency (Postgres row lock via SELECT ... FOR UPDATE).
      const locked = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM "User" WHERE id = ${userId} FOR UPDATE`;
      if (locked.length === 0) throw new AppError('NOT_FOUND', 'User not found');

      const user = await tx.user.findUniqueOrThrow({ where: { id: userId } });
      const premium = isPremiumActive(user, now);

      const existing = await tx.lessonProgress.findUnique({
        where: { userId_lessonId: { userId, lessonId } },
      });
      const firstCompletion = existing?.etat !== 'completed';
      // XP = 15 + correctCount×2 (bounded), doubled for premium, doubled again
      // while a bought double-XP boost is running. 0 on replays (anti-farm).
      const baseXp = lessonXp(correctCount ?? testStepCount, testStepCount);
      const doubleXp = isDoubleXpActive(user.doubleXpUntil, now);
      const gained = firstCompletion
        ? applyXpMultiplier(baseXp, premium) * (doubleXp ? DOUBLE_XP_MULTIPLIER : 1)
        : 0;

      // Mark progress (idempotent).
      await tx.lessonProgress.upsert({
        where: { userId_lessonId: { userId, lessonId } },
        create: { userId, lessonId, etat: 'completed', score: score ?? 100, completedAt: now },
        update: { etat: 'completed', score: score ?? 100, completedAt: now },
      });

      let u = user;
      let league: { weekId: string; amount: number } | null = null;
      let gemsGained = 0;
      if (firstCompletion) {
        // Pending missed days may consume streak-freeze items (Plus: unlimited,
        // nothing decremented).
        const streak = applyActivity(
          {
            streak: user.streak,
            streakFrozen: user.streakFrozen,
            lastStreakValue: user.lastStreakValue,
            lastActivityDate: user.lastActivityDate,
          },
          user.timezone,
          now,
          premium ? Number.POSITIVE_INFINITY : user.streakFreezes,
        );
        const freezesConsumed = premium ? 0 : streak.freezesConsumed;

        // Gems (economy source), ledgered row by row in the same transaction:
        //  - lesson +10, or +20 when perfect (0 mistakes on the test steps);
        //  - +5 the first time the streak counts today (+50 at D7, +150 at D30).
        const perfect =
          testStepCount > 0 && (correctCount ?? testStepCount) >= testStepCount;
        const gemRows: { amount: number; reason: 'lesson_complete' | 'lesson_perfect' | 'daily_streak' | 'streak_bonus'; ref: string }[] = [
          perfect
            ? { amount: GEM_LESSON_PERFECT, reason: 'lesson_perfect', ref: lessonId }
            : { amount: GEM_LESSON_COMPLETE, reason: 'lesson_complete', ref: lessonId },
        ];
        const streakCountedToday =
          streak.streak > 0 &&
          (user.streak === 0 ||
            user.lastActivityDate == null ||
            localDayKey(user.lastActivityDate, user.timezone) !== localDayKey(now, user.timezone));
        if (streakCountedToday) {
          gemRows.push({ amount: GEM_DAILY_STREAK, reason: 'daily_streak', ref: `d${streak.streak}` });
          const milestone = GEM_STREAK_MILESTONES[streak.streak];
          if (milestone) {
            gemRows.push({ amount: milestone, reason: 'streak_bonus', ref: `d${streak.streak}` });
          }
        }
        gemsGained = gemRows.reduce((sum, r) => sum + r.amount, 0);
        await tx.gemTransaction.createMany({
          data: gemRows.map((r) => ({ userId, ...r })),
        });

        u = await tx.user.update({
          where: { id: userId },
          data: {
            xp: { increment: gained },
            weeklyXp: { increment: gained },
            gems: { increment: gemsGained },
            ...(freezesConsumed > 0 ? { streakFreezes: { decrement: freezesConsumed } } : {}),
            streak: streak.streak,
            streakFrozen: streak.streakFrozen,
            lastStreakValue: streak.lastStreakValue,
            lastActivityDate: streak.lastActivityDate,
          },
        });
        // League weekly XP, in the SAME transaction (no divergence with the DB).
        league = await leagueService.addXpIfMemberTx(tx, userId, gained);
      }

      // Record today's LOCAL day as active (idempotent per day) so the profile
      // calendar can mark exactly the days studied. Done on every completion,
      // not only the first, since replaying still means the user studied today.
      const dayKey = localDayKey(now, user.timezone);
      await tx.activityDay.upsert({
        where: { userId_day: { userId, day: dayKey } },
        create: { userId, day: dayKey },
        update: {},
      });

      return { u, gained, gemsGained, premium, firstCompletion, league };
    });

    // Mirror the league XP into Redis AFTER the DB commit (best-effort; the DB
    // remains the source of truth and ranking falls back to SQL if Redis is
    // down or cold).
    if (result.league) {
      await leagueService.mirrorRankXp(result.league.weekId, userId, result.league.amount);
    }

    return {
      xpGained: result.gained,
      gemsGained: result.gemsGained,
      alreadyCompleted: !result.firstCompletion,
      totalXp: result.u.xp,
      weeklyXp: result.u.weeklyXp,
      gems: result.u.gems,
      streak: result.u.streak,
      streakFrozen: result.u.streakFrozen,
      premium: result.premium,
    };
  },

  /**
   * Same as `complete`, but returns the FLAT /me shape the RN store hydrates
   * from (BACKEND.md: POST /lesson/complete → full user state). `complete`
   * already credited XP/streak/league; here we just re-read and serialize.
   */
  async completeFlat(userId: string, lessonId: string, correctCount?: number, score?: number) {
    await this.complete(userId, lessonId, correctCount, score);
    const now = new Date();
    const user = await userRepository.getOrThrow(userId);
    const stats = await computeUserStats(userId);
    return serializeUserFlat(user, stats, now);
  },
};

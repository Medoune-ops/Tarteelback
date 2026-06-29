import { prisma } from '../../config/prisma.js';
import { AppError } from '../../core/errors.js';
import { isPremiumActive, applyXpMultiplier } from '../../core/premium.js';
import { computeHearts, snapshot, MAX_HEARTS } from '../../core/hearts.js';
import { applyActivity } from '../../core/streak.js';
import { judgeStep, type AnswerInput, type StepType } from '../../core/lessonJudge.js';
import { userRepository } from '../me/user.repository.js';
import { leagueService } from '../leagues/league.service.js';
import { lessonRepository } from './lesson.repository.js';

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

    // Number of test steps (written/voice) — the cap for correctCount.
    const testStepCount = lesson.steps.filter((s) => s.type !== 'discovery').length;

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
      // XP = 15 + correctCount×2 (bounded), doubled for premium. Matches the
      // front's barème. 0 on replays (anti-farm).
      const baseXp = lessonXp(correctCount ?? testStepCount, testStepCount);
      const gained = firstCompletion ? applyXpMultiplier(baseXp, premium) : 0;

      // Mark progress (idempotent).
      await tx.lessonProgress.upsert({
        where: { userId_lessonId: { userId, lessonId } },
        create: { userId, lessonId, etat: 'completed', score: score ?? 100, completedAt: now },
        update: { etat: 'completed', score: score ?? 100, completedAt: now },
      });

      let u = user;
      let league: { weekId: string; amount: number } | null = null;
      if (firstCompletion) {
        const streak = applyActivity(
          {
            streak: user.streak,
            streakFrozen: user.streakFrozen,
            lastStreakValue: user.lastStreakValue,
            lastActivityDate: user.lastActivityDate,
          },
          user.timezone,
          now,
        );
        u = await tx.user.update({
          where: { id: userId },
          data: {
            xp: { increment: gained },
            weeklyXp: { increment: gained },
            streak: streak.streak,
            streakFrozen: streak.streakFrozen,
            lastStreakValue: streak.lastStreakValue,
            lastActivityDate: streak.lastActivityDate,
          },
        });
        // League weekly XP, in the SAME transaction (no divergence with the DB).
        league = await leagueService.addXpIfMemberTx(tx, userId, gained);
      }

      return { u, gained, premium, firstCompletion, league };
    });

    // Mirror the league XP into Redis AFTER the DB commit (best-effort; the DB
    // remains the source of truth and ranking falls back to SQL if Redis is
    // down or cold).
    if (result.league) {
      await leagueService.mirrorRankXp(result.league.weekId, userId, result.league.amount);
    }

    return {
      xpGained: result.gained,
      alreadyCompleted: !result.firstCompletion,
      totalXp: result.u.xp,
      weeklyXp: result.u.weeklyXp,
      streak: result.u.streak,
      streakFrozen: result.u.streakFrozen,
      premium: result.premium,
    };
  },
};

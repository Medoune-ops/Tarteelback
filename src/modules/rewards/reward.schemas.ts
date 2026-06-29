import { z } from 'zod';
import { MAX_STREAK_GOAL } from '../../core/rewards.js';

export const setStreakGoalSchema = z
  .object({ days: z.number().int().min(1).max(MAX_STREAK_GOAL) })
  .strict();

export type SetStreakGoalInput = z.infer<typeof setStreakGoalSchema>;

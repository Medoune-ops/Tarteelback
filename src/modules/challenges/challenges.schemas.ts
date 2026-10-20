import { z } from 'zod';

const streakGoalSchema = z
  .object({
    type: z.literal('streak').optional(),
    kind: z.literal('streak').optional(),
    metric: z.literal('streak').optional(),
    days: z.coerce.number().int().min(3).max(100).optional(),
    targetDays: z.coerce.number().int().min(3).max(100).optional(),
  })
  .refine((o) => (o.days ?? o.targetDays) != null, { message: 'days required' });

const souratesGoalSchema = z
  .object({
    type: z.literal('sourates').optional(),
    kind: z.literal('sourates').optional(),
    metric: z.literal('sourates').optional(),
    sourateNumeros: z.array(z.coerce.number().int().min(1).max(114)).min(1).max(30).optional(),
    numeros: z.array(z.coerce.number().int().min(1).max(114)).min(1).max(30).optional(),
    from: z.coerce.number().int().min(1).max(114).optional(),
    to: z.coerce.number().int().min(1).max(114).optional(),
  })
  .refine((o) => (o.sourateNumeros ?? o.numeros) != null || (o.from != null && o.to != null), {
    message: 'sourateNumeros or from/to required',
  });

export const challengeGoalSchema = z.union([streakGoalSchema, souratesGoalSchema]);

export const challengePreviewSchema = z
  .object({
    type: z.enum(['streak', 'sourates']),
    goal: challengeGoalSchema,
    inviteeIds: z.array(z.string().min(1)).min(1).max(9),
  })
  .strict();

export const challengeCreateSchema = z
  .object({
    type: z.enum(['streak', 'sourates']),
    goal: challengeGoalSchema,
    durationDays: z.coerce.number().int().min(1),
    title: z.string().trim().min(1).max(60).optional(),
    inviteeIds: z.array(z.string().min(1)).min(1).max(9),
  })
  .strict();

export const challengeListQuerySchema = z
  .object({
    status: z.enum(['active', 'pending', 'completed']).optional(),
    cursor: z.string().optional(),
    limit: z.coerce.number().int().min(1).max(50).default(20).optional(),
  })
  .strict();

export const challengeParamsSchema = z.object({ id: z.string().min(1) }).strict();

export const challengeNudgeBodySchema = z
  .object({ userId: z.string().min(1) })
  .strict();
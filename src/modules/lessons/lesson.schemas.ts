import { z } from 'zod';

/** Body for POST /lessons/:id/steps/:stepId/answer. */
export const answerSchema = z
  .object({
    // written: chosen option id
    optionId: z.string().optional(),
    // voice: recognition score 0–100
    score: z.number().min(0).max(100).optional(),
    transcription: z.string().max(2000).optional(),
  })
  .strict();

/** Body for POST /lessons/:id/complete. */
export const completeSchema = z
  .object({
    // optional client hint; the server still recomputes the canonical score
    correctCount: z.number().int().min(0).optional(),
    totalTests: z.number().int().min(0).optional(),
  })
  .strict()
  .default({});

/**
 * Body for the flat POST /lesson/complete (RN store contract, BACKEND.md).
 * `lessonId` is the content lesson's id (cuid). `correctAnswers`/`totalAnswers`
 * mirror the front's tally; `durationMs` is accepted but currently advisory.
 */
export const completeFlatSchema = z
  .object({
    lessonId: z.string().min(1),
    correctAnswers: z.number().int().min(0).optional(),
    totalAnswers: z.number().int().min(0).optional(),
    durationMs: z.number().int().min(0).optional(),
  })
  .strict();

export type AnswerBody = z.infer<typeof answerSchema>;
export type CompleteBody = z.infer<typeof completeSchema>;
export type CompleteFlatBody = z.infer<typeof completeFlatSchema>;

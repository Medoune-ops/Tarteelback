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

export type AnswerBody = z.infer<typeof answerSchema>;
export type CompleteBody = z.infer<typeof completeSchema>;

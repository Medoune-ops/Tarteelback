import { z } from 'zod';

export const sendRequestSchema = z.object({
  code: z.string().trim().length(6),
}).strict();

export const respondRequestParamsSchema = z.object({
  id: z.string().min(1),
}).strict();

export const removeFriendParamsSchema = z.object({
  userId: z.string().min(1),
}).strict();

export const cursorQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20).optional(),
}).strict();

export type SendRequestInput = z.infer<typeof sendRequestSchema>;
export type CursorQuery = z.infer<typeof cursorQuerySchema>;
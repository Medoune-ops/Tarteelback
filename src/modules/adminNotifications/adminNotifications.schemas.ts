import { z } from 'zod';

/** POST /backoffice/notifications/broadcast */
export const broadcastSchema = z
  .object({
    type: z.enum(['feature', 'maintenance', 'incident', 'info']),
    title: z.string().trim().min(1).max(80),
    message: z.string().trim().min(1).max(200),
    audience: z.enum(['all', 'premium', 'free']),
  })
  .strict();

export type BroadcastInput = z.infer<typeof broadcastSchema>;

/** GET /backoffice/notifications/history */
export const historyQuerySchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(100).optional(),
  })
  .strict();

export type HistoryQuery = z.infer<typeof historyQuerySchema>;

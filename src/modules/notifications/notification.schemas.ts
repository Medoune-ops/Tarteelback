import { z } from 'zod';

export const registerTokenSchema = z
  .object({
    token: z.string().min(1).max(200),
    deviceId: z.string().min(1).max(200),
    platform: z.enum(['ios', 'android', 'web']).optional(),
  })
  .strict();

export const removeTokenSchema = z
  .object({ token: z.string().min(1).max(200) })
  .strict();

/** Notification preferences (subset of User), all optional. */
export const prefsSchema = z
  .object({
    notifDailyReminder: z.boolean().optional(),
    notifStreakAlert: z.boolean().optional(),
    reminderHour: z.number().int().min(0).max(23).optional(),
  })
  .strict()
  .refine((o) => Object.keys(o).length > 0, { message: 'No preferences to update' });

export type RegisterTokenInput = z.infer<typeof registerTokenSchema>;
export type RemoveTokenInput = z.infer<typeof removeTokenSchema>;
export type PrefsInput = z.infer<typeof prefsSchema>;

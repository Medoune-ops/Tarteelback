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

export const inviteTokenParamsSchema = z.object({
  token: z.string().min(1),
}).strict();

export type InviteTokenParams = z.infer<typeof inviteTokenParamsSchema>;
export const friendProfileParamsSchema = z.object({
  userId: z.string().min(1),
}).strict();

export const friendSettingsSchema = z
  .object({
    friendsDiscoverable: z.boolean().optional(),
    friendsVisibility: z.enum(['friends', 'private']).optional(),
    notifFriends: z.boolean().optional(),
  })
  .strict()
  .refine((o) => Object.keys(o).length > 0, { message: 'No settings to update' });

export const reportSchema = z
  .object({
    targetUserId: z.string().min(1),
    targetKind: z.enum(['user', 'message', 'achievement']),
    targetRef: z.string().min(1).max(200),
    reason: z.enum(['spam', 'harassment', 'inappropriate', 'other']),
    details: z.string().trim().max(500).optional(),
  })
  .strict();

export const blockParamsSchema = z.object({
  userId: z.string().min(1),
}).strict();

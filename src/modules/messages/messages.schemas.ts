import { z } from 'zod';

const HADITH_COLLECTIONS = ['nawawi', 'qudsi', 'bukhari', 'muslim'] as const;
const ENCOURAGEMENT_KEYS = ['keep_going', 'proud_of_you', 'dua_for_you'] as const;

const hadithPayloadSchema = z.object({
  collection: z.enum(HADITH_COLLECTIONS),
  n: z.number().int().positive(),
});

const achievementPayloadSchema = z.object({
  achievementId: z.string().min(1),
});

const encouragementPayloadSchema = z.object({
  key: z.enum(ENCOURAGEMENT_KEYS),
});

export const messagePayloadSchema = z.union([
  hadithPayloadSchema,
  achievementPayloadSchema,
  encouragementPayloadSchema,
]);

export const messageSendSchema = z
  .object({
    recipientIds: z.array(z.string().min(1)).min(1).max(10),
    kind: z.enum(['hadith', 'achievement', 'encouragement']),
    payload: messagePayloadSchema,
    note: z.string().trim().max(140).optional(),
  })
  .strict();

export const messageReadParamsSchema = z.object({
  id: z.string().min(1),
});

export const messageListQuerySchema = z
  .object({
    cursor: z.string().optional(),
    limit: z.coerce.number().int().min(1).max(50).default(20).optional(),
  })
  .strict();

export type MessageSendInput = z.infer<typeof messageSendSchema>;

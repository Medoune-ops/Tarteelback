import { z } from 'zod';

/** Ajouter un ami par code (saisi OU scanné depuis le QR — même route). */
export const addFriendSchema = z
  .object({
    code: z.string().trim().min(1).max(16),
  })
  .strict();
export type AddFriendInput = z.infer<typeof addFriendSchema>;

/** Bloquer un utilisateur (par userId). Retire aussi les défis partagés. */
export const blockUserSchema = z
  .object({
    userId: z.string().min(1),
  })
  .strict();
export type BlockUserInput = z.infer<typeof blockUserSchema>;

/** Signalement d'abus — motif court obligatoire. */
export const reportUserSchema = z
  .object({
    userId: z.string().min(1),
    reason: z.string().trim().min(1).max(500),
  })
  .strict();
export type ReportUserInput = z.infer<typeof reportUserSchema>;

/** Paramètre de route `:id` (id d'une amitié). */
export const friendshipIdParamsSchema = z
  .object({
    id: z.string().min(1),
  })
  .strict();
export type FriendshipIdParams = z.infer<typeof friendshipIdParamsSchema>;

/** Paramètre de route `:userId` (pour débloquer / progrès d'un ami). */
export const userIdParamsSchema = z
  .object({
    userId: z.string().min(1),
  })
  .strict();
export type UserIdParams = z.infer<typeof userIdParamsSchema>;

/** Paramètre de route `:activityId` (réaction « bravo »). */
export const activityIdParamsSchema = z
  .object({
    activityId: z.string().min(1),
  })
  .strict();
export type ActivityIdParams = z.infer<typeof activityIdParamsSchema>;

/** Paramètre de route `:messageId` (marquer lu). */
export const messageIdParamsSchema = z
  .object({
    messageId: z.string().min(1),
  })
  .strict();
export type MessageIdParams = z.infer<typeof messageIdParamsSchema>;

const FRIEND_SEND_TYPES = ['hadith', 'success', 'encouragement', 'reminder'] as const;

/**
 * Envoi « à un ami ». Le champ requis dépend du type :
 *  - hadith        : collectionId + n (référence locale du destinataire)
 *  - encouragement : text
 *  - reminder      : challengeId
 *  - success       : numero (sourate) obligatoire — le serveur vérifie que
 *                    l'expéditeur l'a réellement maîtrisée (règle 2). `text`
 *                    optionnel.
 */
export const sendMessageSchema = z
  .object({
    type: z.enum(FRIEND_SEND_TYPES),
    collectionId: z.string().trim().min(1).max(40).optional(),
    n: z.number().int().positive().max(100000).optional(),
    numero: z.number().int().positive().max(114).optional(),
    text: z.string().trim().min(1).max(280).optional(),
    challengeId: z.string().min(1).optional(),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (v.type === 'hadith' && (v.collectionId == null || v.n == null)) {
      ctx.addIssue({ code: 'custom', message: 'hadith requires collectionId and n' });
    }
    if (v.type === 'encouragement' && v.text == null) {
      ctx.addIssue({ code: 'custom', message: 'encouragement requires text' });
    }
    if (v.type === 'reminder' && v.challengeId == null) {
      ctx.addIssue({ code: 'custom', message: 'reminder requires challengeId' });
    }
    // Règle 2 : une réussite partagée doit référencer une sourate que le
    // serveur pourra vérifier (le client n'affirme jamais la réussite).
    if (v.type === 'success' && v.numero == null) {
      ctx.addIssue({ code: 'custom', message: 'success requires a mastered sourate (numero)' });
    }
  });
export type SendMessageInput = z.infer<typeof sendMessageSchema>;

/** Création d'un défi partagé. */
export const createChallengeSchema = z
  .object({
    title: z.string().trim().min(1).max(80),
    metric: z.enum(['xp', 'streak', 'sourates']),
    targetValue: z.number().int().positive().max(100000),
    endsAt: z.coerce.date(),
    friendIds: z.array(z.string().min(1)).min(1).max(19),
    sourateNumeros: z.array(z.number().int().min(1).max(114)).optional(),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (v.metric === 'sourates') {
      if (!v.sourateNumeros || v.sourateNumeros.length === 0) {
        ctx.addIssue({ code: 'custom', message: 'sourateNumeros required for sourates metric' });
        return;
      }
      if (v.sourateNumeros.length > 114) {
        ctx.addIssue({ code: 'custom', message: 'too many sourates selected' });
      }
      const unique = new Set(v.sourateNumeros);
      if (unique.size !== v.sourateNumeros.length) {
        ctx.addIssue({ code: 'custom', message: 'duplicate sourate selected' });
      }
    }
  });
export type CreateChallengeInput = z.infer<typeof createChallengeSchema>;

/** Paramètre de route `:challengeId`. */
export const challengeIdParamsSchema = z
  .object({
    challengeId: z.string().min(1),
  })
  .strict();
export type ChallengeIdParams = z.infer<typeof challengeIdParamsSchema>;

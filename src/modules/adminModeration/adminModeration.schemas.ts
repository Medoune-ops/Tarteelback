import { z } from 'zod';

export const listReportsQuerySchema = z
  .object({
    status: z.enum(['open', 'reviewed', 'actioned']).optional(),
    targetUserId: z.string().min(1).optional(),
    cursor: z.string().min(1).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(30),
  })
  .strict();
export type ListReportsQuery = z.infer<typeof listReportsQuerySchema>;

export const reportParamsSchema = z.object({ id: z.string().min(1) }).strict();
export const userParamsSchema = z.object({ userId: z.string().min(1) }).strict();

/**
 * Traiter un signalement :
 *  - dismiss : rien à reprocher → « reviewed » ;
 *  - disable_friends : couper l'accès aux fonctions entre amis du compte visé ;
 *  - ban : bannir le compte (sessions révoquées, il disparaît des listes).
 * Les deux dernières passent le signalement (et les autres signalements
 * ouverts sur ce compte) à « actioned ».
 */
export const resolveReportBodySchema = z
  .object({
    action: z.enum(['dismiss', 'disable_friends', 'ban']),
    note: z.string().trim().max(500).optional(),
  })
  .strict();
export type ResolveReportBody = z.infer<typeof resolveReportBodySchema>;

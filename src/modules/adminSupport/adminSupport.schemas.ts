import { z } from 'zod';

/** GET /backoffice/support/messages — recherche (nom/email) + filtre statut + pagination, une ligne par utilisateur. */
export const listSupportQuerySchema = z
  .object({
    q: z.string().trim().max(200).optional(),
    status: z.enum(['all', 'unread', 'read']).default('all'),
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(20),
  })
  .strict();

export type ListSupportQuery = z.infer<typeof listSupportQuerySchema>;

/** POST /backoffice/support/messages/:userId/reply */
export const replySupportSchema = z
  .object({
    message: z.string().trim().min(1).max(2000),
  })
  .strict();

export type ReplySupportInput = z.infer<typeof replySupportSchema>;

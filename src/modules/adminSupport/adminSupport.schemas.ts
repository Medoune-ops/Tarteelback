import { z } from 'zod';

/** GET /backoffice/support/messages — recherche (nom/email/contenu) + filtre statut + pagination. */
export const listSupportQuerySchema = z
  .object({
    q: z.string().trim().max(200).optional(),
    status: z.enum(['all', 'unread', 'read']).default('all'),
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(20),
  })
  .strict();

export type ListSupportQuery = z.infer<typeof listSupportQuerySchema>;

import { z } from 'zod';

/** POST /me/support — texte libre, pas de catégorie (réclamation ou suggestion). */
export const sendSupportMessageSchema = z
  .object({
    message: z.string().trim().min(1).max(2000),
  })
  .strict();

export type SendSupportMessageInput = z.infer<typeof sendSupportMessageSchema>;

import { z } from 'zod';

/** Invitation par email (normalisé en minuscules). */
export const inviteSchema = z
  .object({
    email: z
      .string()
      .email()
      .transform((e) => e.toLowerCase().trim()),
  })
  .strict();
export type InviteInput = z.infer<typeof inviteSchema>;

/** Transfert de propriété / retrait de membre : cible par userId. */
export const targetUserSchema = z
  .object({
    userId: z.string().min(1),
  })
  .strict();
export type TargetUserInput = z.infer<typeof targetUserSchema>;

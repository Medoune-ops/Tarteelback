import { z } from 'zod';

/**
 * Avatar composé dans l'app (écran « Mon avatar »).
 *
 * Stocké tel quel en JSON sur User.avatarStyle et renvoyé aux amis, aux
 * ligues, etc. Le client le dessine lui-même : le serveur ne fait que valider
 * qu'il ne contient QUE des choix connus et des couleurs hexadécimales.
 */
const hexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Expected a #rrggbb colour');

export const avatarStyleSchema = z
  .object({
    face: z.enum(['rond', 'ovale']),
    skin: hexColor,
    hair: z.enum(['aucune', 'courts', 'boucles', 'longs', 'kufi', 'hijab', 'bonnet']),
    hairColor: hexColor,
    eyes: z.enum(['points', 'joyeux', 'grands', 'clin']),
    mouth: z.enum(['sourire', 'rire', 'calme', 'surpris']),
    acc: z.enum(['aucun', 'joues', 'lunettes', 'barbe']),
    outfit: z.enum(['tshirt', 'col', 'qamis']),
    outfitColor: hexColor,
    bg: hexColor,
  })
  .strict();

export type AvatarStyle = z.infer<typeof avatarStyleSchema>;

/**
 * Lecture : renvoie l'avatar s'il est valide, sinon null.
 *
 * Une valeur stockée devenue invalide (ancien choix retiré, donnée corrompue)
 * ne doit pas faire échouer une liste d'amis : on l'ignore et le client
 * affiche l'avatar par défaut.
 */
export function readAvatarStyle(value: unknown): AvatarStyle | null {
  if (value == null) return null;
  const parsed = avatarStyleSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

import { z } from 'zod';

export const setPublishedSchema = z
  .object({
    published: z.boolean(),
  })
  .strict();

export type SetPublishedInput = z.infer<typeof setPublishedSchema>;

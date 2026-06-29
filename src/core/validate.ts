import type { ZodTypeAny, z } from 'zod';
import { AppError } from './errors.js';

/**
 * Parse `data` with a Zod schema, converting failures into a uniform
 * VALIDATION_ERROR AppError (so the global handler shapes the response).
 * Returns the schema's OUTPUT type (so `.default()` etc. are resolved).
 */
export function parse<S extends ZodTypeAny>(schema: S, data: unknown): z.infer<S> {
  const result = schema.safeParse(data);
  if (!result.success) {
    throw new AppError('VALIDATION_ERROR', 'Invalid input', result.error.flatten());
  }
  return result.data;
}

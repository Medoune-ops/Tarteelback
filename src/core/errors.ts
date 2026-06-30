/**
 * Application error codes. These are part of the API contract — the React
 * Native front switches on `error.code` (e.g. OUT_OF_HEARTS → "Plus de cœurs"
 * screen). Keep this list and the OpenAPI doc in sync.
 */
export type ErrorCode =
  | 'VALIDATION_ERROR'
  | 'UNAUTHENTICATED'
  | 'INVALID_CREDENTIALS'
  | 'TOKEN_EXPIRED'
  | 'TOKEN_REVOKED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'EMAIL_TAKEN'
  | 'OAUTH_INVALID'
  | 'OUT_OF_HEARTS'
  | 'LESSON_LOCKED'
  | 'ALREADY_PREMIUM'
  | 'NO_STREAK_TO_REPAIR'
  | 'PAYMENT_FAILED'
  | 'RATE_LIMITED'
  | 'SERVICE_UNAVAILABLE'
  | 'INTERNAL';

/** Default HTTP status for each error code. */
const STATUS: Record<ErrorCode, number> = {
  VALIDATION_ERROR: 400,
  UNAUTHENTICATED: 401,
  INVALID_CREDENTIALS: 401,
  TOKEN_EXPIRED: 401,
  TOKEN_REVOKED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  EMAIL_TAKEN: 409,
  OAUTH_INVALID: 401,
  OUT_OF_HEARTS: 403,
  LESSON_LOCKED: 403,
  ALREADY_PREMIUM: 409,
  NO_STREAK_TO_REPAIR: 409,
  PAYMENT_FAILED: 402,
  RATE_LIMITED: 429,
  SERVICE_UNAVAILABLE: 503,
  INTERNAL: 500,
};

/**
 * The single error type thrown across the codebase. Carries a machine-readable
 * `code`, an HTTP `statusCode`, a human message and optional `details`.
 */
export class AppError extends Error {
  readonly code: ErrorCode;
  readonly statusCode: number;
  readonly details?: unknown;

  constructor(code: ErrorCode, message?: string, details?: unknown) {
    super(message ?? code);
    this.name = 'AppError';
    this.code = code;
    this.statusCode = STATUS[code];
    this.details = details;
  }
}

// Convenience factories for the most common cases.
export const Errors = {
  unauthenticated: (msg = 'Authentication required') =>
    new AppError('UNAUTHENTICATED', msg),
  forbidden: (msg = 'You are not allowed to do that') =>
    new AppError('FORBIDDEN', msg),
  notFound: (msg = 'Resource not found') => new AppError('NOT_FOUND', msg),
  outOfHearts: (msg = 'You have no hearts left') =>
    new AppError('OUT_OF_HEARTS', msg),
  validation: (details: unknown, msg = 'Invalid input') =>
    new AppError('VALIDATION_ERROR', msg, details),
};

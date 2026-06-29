import argon2 from 'argon2';

/** Hash a plaintext password with argon2id (memory-hard, recommended). */
export function hashPassword(plain: string): Promise<string> {
  return argon2.hash(plain, { type: argon2.argon2id });
}

/** Verify a plaintext password against a stored hash. */
export function verifyPassword(hash: string, plain: string): Promise<boolean> {
  return argon2.verify(hash, plain).catch(() => false);
}

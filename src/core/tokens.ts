import crypto from 'node:crypto';
import { env } from '../config/env.js';

/**
 * Refresh tokens. We generate an opaque random token, return it to the client,
 * but persist only a SHA-256 hash. A leaked DB therefore can't be replayed.
 */
export function generateRefreshToken(): string {
  return crypto.randomBytes(48).toString('base64url');
}

export function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

/** Expiry date for a freshly issued refresh token (sliding window). */
export function refreshExpiry(now: Date = new Date()): Date {
  return new Date(now.getTime() + env.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000);
}

/** Compute avatar initials from a display name (e.g. "Yasmine A." -> "YA"). */
export function initialsFrom(displayName: string): string {
  const parts = displayName.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '';
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
}

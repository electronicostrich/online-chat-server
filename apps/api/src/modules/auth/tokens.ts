import { createHash, randomBytes } from 'node:crypto';

// Opaque session token. 32 bytes = 256 bits of entropy, hex-encoded so it fits
// in a cookie without URL encoding. We store only the SHA-256 of this token;
// the raw value travels only in the chat_sid cookie.
const SESSION_TOKEN_BYTES = 32;
const CSRF_TOKEN_BYTES = 32;

export function generateSessionToken(): string {
  return randomBytes(SESSION_TOKEN_BYTES).toString('hex');
}

export function hashSessionToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function generateCsrfToken(): string {
  return randomBytes(CSRF_TOKEN_BYTES).toString('hex');
}

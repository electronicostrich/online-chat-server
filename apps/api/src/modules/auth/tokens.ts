import { createHash, randomBytes } from 'node:crypto';

// Opaque token generation shared by session/csrf/reset flows. We store
// hashed forms on the server; the raw value is only ever transmitted via a
// cookie (sessions, csrf) or a reset email (reset tokens) and is hashed on
// arrival before lookup.
const SESSION_TOKEN_BYTES = 32;
const CSRF_TOKEN_BYTES = 32;
const RESET_TOKEN_BYTES = 32;

function generateToken(byteLength: number): string {
  return randomBytes(byteLength).toString('hex');
}

function hashToken(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function generateSessionToken(): string {
  return generateToken(SESSION_TOKEN_BYTES);
}

export function hashSessionToken(token: string): string {
  return hashToken(token);
}

export function generateCsrfToken(): string {
  return generateToken(CSRF_TOKEN_BYTES);
}

export function generateResetToken(): string {
  return generateToken(RESET_TOKEN_BYTES);
}

export function hashResetToken(token: string): string {
  return hashToken(token);
}

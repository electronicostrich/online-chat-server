import type { FastifyReply } from 'fastify';
import { config } from '../../config/env.js';

export const CSRF_COOKIE_NAME = 'csrf_token';
export const CSRF_HEADER_NAME = 'x-csrf-token';

interface CookieBaseOptions {
  path: '/';
  sameSite: 'lax' | 'strict' | 'none';
  secure: boolean;
  maxAge: number;
}

function baseOptions(): CookieBaseOptions {
  return {
    path: '/',
    sameSite: config.SESSION_COOKIE_SAMESITE,
    secure: config.SESSION_COOKIE_SECURE,
    maxAge: config.SESSION_TTL_SECONDS,
  };
}

export function setSessionCookies(
  reply: FastifyReply,
  sessionToken: string,
  csrfToken: string,
): void {
  reply.setCookie(config.SESSION_COOKIE_NAME, sessionToken, {
    ...baseOptions(),
    httpOnly: true,
  });
  // CSRF token is a sibling cookie read by the browser's JS client so it can
  // echo it back in the X-CSRF-Token header (double-submit pattern). Not
  // httpOnly — the client needs to read it.
  reply.setCookie(CSRF_COOKIE_NAME, csrfToken, {
    ...baseOptions(),
    httpOnly: false,
  });
}

export function clearSessionCookies(reply: FastifyReply): void {
  reply.clearCookie(config.SESSION_COOKIE_NAME, { path: '/' });
  reply.clearCookie(CSRF_COOKIE_NAME, { path: '/' });
}

import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import type { FastifyRequest } from 'fastify';
import fastifyCookie from '@fastify/cookie';
import fp from 'fastify-plugin';
import { timingSafeEqual } from 'node:crypto';
import { ErrorCodes } from 'shared-schemas';
import { config } from '../../config/env.js';
import { AuthError, resolveSessionByToken, type ResolvedSession } from './service.js';
import { CSRF_COOKIE_NAME, CSRF_HEADER_NAME } from './cookies.js';

declare module 'fastify' {
  interface FastifyRequest {
    session?: ResolvedSession;
  }
}

const STATE_CHANGING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

// Routes that don't have a prior session to sign the CSRF token against.
// Registration and login issue the first token; password-reset endpoints run
// unauthenticated by design. `/__test/seed` is exempt only in non-prod so a
// regression in NODE_ENV gating cannot turn the seed route into an
// unauthenticated destructive endpoint.
const CSRF_EXEMPT_PATHS = new Set<string>([
  '/auth/register',
  '/auth/login',
  '/auth/password-reset/request',
  '/auth/password-reset/confirm',
  ...(config.NODE_ENV !== 'production' ? ['/__test/seed'] : []),
]);

function constantTimeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

function routePath(req: FastifyRequest): string {
  // For matched routes, req.routeOptions.url is the pattern without query
  // string. Fall back to the URL pathname (never the raw req.url, which
  // includes the query string) so exempt-path comparisons stay safe.
  const routed = req.routeOptions.url;
  if (routed !== undefined) return routed;
  try {
    return new URL(req.url, 'http://local').pathname;
  } catch {
    return req.url;
  }
}

const authPluginImpl: FastifyPluginAsyncTypebox = async (fastify) => {
  await fastify.register(fastifyCookie, { secret: config.SESSION_SECRET });

  fastify.addHook('preHandler', async (req) => {
    const rawToken = req.cookies[config.SESSION_COOKIE_NAME];
    if (rawToken !== undefined && rawToken.length > 0) {
      const resolved = await resolveSessionByToken(rawToken);
      if (resolved !== undefined) {
        req.session = resolved;
      }
    }

    if (!STATE_CHANGING_METHODS.has(req.method)) return;
    if (CSRF_EXEMPT_PATHS.has(routePath(req))) return;

    const cookieToken = req.cookies[CSRF_COOKIE_NAME];
    const headerValue = req.headers[CSRF_HEADER_NAME];
    const headerToken = Array.isArray(headerValue) ? headerValue[0] : headerValue;
    if (
      cookieToken === undefined ||
      headerToken === undefined ||
      !constantTimeEqual(cookieToken, headerToken)
    ) {
      throw new AuthError(
        ErrorCodes.CSRF_FAILED,
        403,
        'CSRF token missing or invalid.',
      );
    }
  });
};

export const authPlugin = fp(authPluginImpl, { name: 'auth-plugin' });

export function requireSession(req: FastifyRequest): ResolvedSession {
  if (req.session === undefined) {
    throw new AuthError(
      ErrorCodes.UNAUTHENTICATED,
      401,
      'Authentication required.',
    );
  }
  return req.session;
}

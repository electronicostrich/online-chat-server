import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import type { FastifyRequest } from 'fastify';
import {
  AuthSessionResponseSchema,
  ErrorCodes,
  ErrorEnvelopeSchema,
  LoginRequestSchema,
  LogoutSessionRequestSchema,
  OkResponseSchema,
  PasswordChangeRequestSchema,
  RegisterRequestSchema,
  SessionsListResponseSchema,
} from 'shared-schemas';
import {
  AuthError,
  changePassword,
  listSessions,
  loginUser,
  registerUser,
  revokeSession,
  toPublicSession,
  toPublicUser,
} from './service.js';
import { clearSessionCookies, setSessionCookies } from './cookies.js';
import { generateCsrfToken } from './tokens.js';
import { requireSession } from './plugin.js';

function clientContext(req: FastifyRequest): {
  userAgent: string | null;
  ipAddress: string | null;
} {
  const ua = req.headers['user-agent'];
  return {
    userAgent: ua !== undefined && ua.length > 0 ? ua : null,
    ipAddress: req.ip.length > 0 ? req.ip : null,
  };
}

export const authRoutes: FastifyPluginAsyncTypebox = (fastify) => {
  fastify.post(
    '/auth/register',
    {
      schema: {
        body: RegisterRequestSchema,
        response: {
          200: AuthSessionResponseSchema,
          400: ErrorEnvelopeSchema,
          409: ErrorEnvelopeSchema,
        },
      },
    },
    async (req, reply) => {
      const { userAgent, ipAddress } = clientContext(req);
      const issued = await registerUser({
        email: req.body.email,
        username: req.body.username,
        password: req.body.password,
        userAgent,
        ipAddress,
      });
      const csrfToken = generateCsrfToken();
      setSessionCookies(reply, issued.sessionToken, csrfToken);
      return reply.status(200).send({
        data: {
          user: toPublicUser(issued.user),
          session: toPublicSession(issued.session),
        },
      });
    },
  );

  fastify.post(
    '/auth/login',
    {
      schema: {
        body: LoginRequestSchema,
        response: {
          200: AuthSessionResponseSchema,
          401: ErrorEnvelopeSchema,
        },
      },
    },
    async (req, reply) => {
      const { userAgent, ipAddress } = clientContext(req);
      const issued = await loginUser({
        email: req.body.email,
        password: req.body.password,
        userAgent,
        ipAddress,
      });
      const csrfToken = generateCsrfToken();
      setSessionCookies(reply, issued.sessionToken, csrfToken);
      return reply.status(200).send({
        data: {
          user: toPublicUser(issued.user),
          session: toPublicSession(issued.session),
        },
      });
    },
  );

  fastify.post(
    '/auth/logout',
    {
      schema: {
        response: {
          200: OkResponseSchema,
          401: ErrorEnvelopeSchema,
        },
      },
    },
    async (req, reply) => {
      const current = req.session;
      if (current === undefined) {
        throw new AuthError(
          ErrorCodes.UNAUTHENTICATED,
          401,
          'No active session.',
        );
      }
      await revokeSession(current.session.id);
      clearSessionCookies(reply);
      return reply.status(200).send({ data: { ok: true } });
    },
  );

  fastify.post(
    '/auth/logout-session',
    {
      schema: {
        body: LogoutSessionRequestSchema,
        response: {
          200: OkResponseSchema,
          401: ErrorEnvelopeSchema,
          404: ErrorEnvelopeSchema,
        },
      },
    },
    async (req, reply) => {
      const current = requireSession(req);
      const targetId = req.body.sessionId;
      const ownSessions = await listSessions(current.user.id);
      const target = ownSessions.find((s) => s.id === targetId);
      if (target === undefined) {
        throw new AuthError(
          ErrorCodes.NOT_FOUND,
          404,
          'Session not found for current user.',
        );
      }
      await revokeSession(target.id);
      if (target.id === current.session.id) {
        clearSessionCookies(reply);
      }
      return reply.status(200).send({ data: { ok: true } });
    },
  );

  fastify.post(
    '/auth/password-change',
    {
      schema: {
        body: PasswordChangeRequestSchema,
        response: {
          200: OkResponseSchema,
          400: ErrorEnvelopeSchema,
          401: ErrorEnvelopeSchema,
          403: ErrorEnvelopeSchema,
        },
      },
    },
    async (req, reply) => {
      const current = requireSession(req);
      await changePassword({
        user: current.user,
        currentSessionId: current.session.id,
        currentPassword: req.body.currentPassword,
        newPassword: req.body.newPassword,
      });
      return reply.status(200).send({ data: { ok: true } });
    },
  );

  fastify.get(
    '/sessions',
    {
      schema: {
        response: {
          200: SessionsListResponseSchema,
          401: ErrorEnvelopeSchema,
        },
      },
    },
    async (req, reply) => {
      const current = requireSession(req);
      const rows = await listSessions(current.user.id);
      const sessions = rows.map((s) => ({
        id: s.id,
        current: s.id === current.session.id,
        userAgent: s.userAgent,
        ipAddress: s.ipAddress,
        createdAt: s.createdAt.toISOString(),
        lastSeenAt: s.lastSeenAt.toISOString(),
      }));
      return reply.status(200).send({ data: { sessions } });
    },
  );
  return Promise.resolve();
};

import Fastify, { type FastifyError } from 'fastify';
import sensible from '@fastify/sensible';
import type { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import { randomUUID } from 'node:crypto';
import { ErrorCodes, type ErrorCode } from 'shared-schemas';
import { loggerOptions } from './logger.js';
import { registerRoutes } from './routes/index.js';
import { AuthError } from './modules/auth/index.js';

// Fallback code when Fastify surfaces an error that didn't come through an
// AuthError (auth code already provides its own precise mapping). Map by
// status so clients can key error-handling logic off `error.code`.
function errorCodeForStatus(status: number): ErrorCode {
  if (status === 503) return ErrorCodes.SERVICE_UNAVAILABLE;
  if (status >= 500) return ErrorCodes.INTERNAL_ERROR;
  if (status === 401) return ErrorCodes.UNAUTHENTICATED;
  if (status === 403) return ErrorCodes.FORBIDDEN;
  if (status === 404) return ErrorCodes.NOT_FOUND;
  if (status === 409) return ErrorCodes.CONFLICT;
  return ErrorCodes.VALIDATION_ERROR;
}

export function buildServer() {
  const app = Fastify({
    logger: loggerOptions,
    genReqId: () => randomUUID(),
    disableRequestLogging: false,
  }).withTypeProvider<TypeBoxTypeProvider>();

  void app.register(sensible);
  void app.register(registerRoutes);

  app.setErrorHandler((err: FastifyError, req, reply) => {
    if (err instanceof AuthError) {
      // 4xx AuthErrors are expected denials (CSRF failure, bad creds,
      // conflict) and stay silent in the log. 5xx shouldn't happen in the
      // happy path, so record it for diagnostics before returning.
      if (err.statusCode >= 500) {
        req.log.error({ err }, 'auth subsystem failure');
      }
      void reply.status(err.statusCode).send({
        error: {
          code: err.code,
          message: err.message,
          ...(err.details !== undefined ? { details: err.details } : {}),
          traceId: req.id,
        },
      });
      return;
    }
    if (err.validation !== undefined) {
      const fieldErrors: Record<string, string> = {};
      for (const v of err.validation) {
        // Required-field errors report the *parent* path in `instancePath`
        // and put the missing key in `params.missingProperty`. Without the
        // join, every missing field at the root collides on the '/' key.
        const missingRaw =
          v.keyword === 'required'
            ? (v.params as { missingProperty?: unknown }).missingProperty
            : undefined;
        const missing =
          typeof missingRaw === 'string' ? missingRaw : undefined;
        const base = v.instancePath;
        const key =
          missing !== undefined
            ? `${base}/${missing}`
            : base === ''
              ? '/'
              : base;
        fieldErrors[key] = v.message ?? 'invalid';
      }
      void reply.status(400).send({
        error: {
          code: ErrorCodes.VALIDATION_ERROR,
          message: 'Request validation failed',
          details: { fieldErrors },
          traceId: req.id,
        },
      });
      return;
    }
    const status = err.statusCode ?? 500;
    req.log.error({ err }, 'request failed');
    void reply.status(status).send({
      error: {
        code: errorCodeForStatus(status),
        message: status >= 500 ? 'Internal server error' : err.message,
        traceId: req.id,
      },
    });
  });

  return app;
}

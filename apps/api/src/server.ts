import Fastify, { type FastifyError } from 'fastify';
import sensible from '@fastify/sensible';
import type { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import { randomUUID } from 'node:crypto';
import { ErrorCodes } from 'shared-schemas';
import { loggerOptions } from './logger.js';
import { registerRoutes } from './routes/index.js';
import { AuthError } from './modules/auth/index.js';

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
        const path = v.instancePath === '' ? '/' : v.instancePath;
        fieldErrors[path] = v.message ?? 'invalid';
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
        code: status >= 500 ? ErrorCodes.INTERNAL_ERROR : ErrorCodes.VALIDATION_ERROR,
        message: status >= 500 ? 'Internal server error' : err.message,
        traceId: req.id,
      },
    });
  });

  return app;
}

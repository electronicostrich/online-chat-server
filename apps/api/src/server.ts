import Fastify from 'fastify';
import sensible from '@fastify/sensible';
import type { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import { randomUUID } from 'node:crypto';
import { config } from './config/env.js';
import { registerRoutes } from './routes/index.js';

export function buildServer() {
  const loggerOptions =
    config.NODE_ENV === 'development'
      ? { level: config.LOG_LEVEL, transport: { target: 'pino-pretty' } }
      : { level: config.LOG_LEVEL };

  const app = Fastify({
    logger: loggerOptions,
    genReqId: () => randomUUID(),
    disableRequestLogging: false,
  }).withTypeProvider<TypeBoxTypeProvider>();

  void app.register(sensible);
  void app.register(registerRoutes);

  return app;
}

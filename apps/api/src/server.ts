import Fastify from 'fastify';
import sensible from '@fastify/sensible';
import type { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import { randomUUID } from 'node:crypto';
import { loggerOptions } from './logger.js';
import { registerRoutes } from './routes/index.js';

export function buildServer() {
  const app = Fastify({
    logger: loggerOptions,
    genReqId: () => randomUUID(),
    disableRequestLogging: false,
  }).withTypeProvider<TypeBoxTypeProvider>();

  void app.register(sensible);
  void app.register(registerRoutes);

  return app;
}

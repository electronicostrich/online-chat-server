import Fastify, { type FastifyInstance } from 'fastify';
import sensible from '@fastify/sensible';
import type { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import { randomUUID } from 'node:crypto';
import { logger } from './logger.js';
import { registerRoutes } from './routes/index.js';

export function buildServer(): FastifyInstance {
  const app = Fastify({
    logger,
    genReqId: () => randomUUID(),
    disableRequestLogging: false,
  }).withTypeProvider<TypeBoxTypeProvider>();

  void app.register(sensible);
  void app.register(registerRoutes);

  return app;
}

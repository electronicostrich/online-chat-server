import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { healthzRoute } from './healthz.js';
import { testSeedRoute } from './test-seed.js';

export const registerRoutes: FastifyPluginAsyncTypebox = async (fastify) => {
  await fastify.register(healthzRoute);
  await fastify.register(testSeedRoute);
};

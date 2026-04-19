import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { authPlugin, authRoutes } from '../modules/auth/index.js';
import { healthzRoute } from './healthz.js';
import { testSeedRoute } from './test-seed.js';

export const registerRoutes: FastifyPluginAsyncTypebox = async (fastify) => {
  await fastify.register(authPlugin);
  await fastify.register(healthzRoute);
  await fastify.register(testSeedRoute);
  await fastify.register(authRoutes);
};

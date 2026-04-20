import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { authPlugin, authRoutes } from '../modules/auth/index.js';
import { roomsRoutes } from '../modules/rooms/index.js';
import { friendsRoutes } from '../modules/friends/index.js';
import { blocksRoutes } from '../modules/blocks/index.js';
import { messagesRoutes } from '../modules/messages/index.js';
import { attachmentsRoutes, attachmentsTestHelpers } from '../modules/attachments/index.js';
import { config } from '../config/env.js';
import { realtimeGateway } from '../modules/realtime/index.js';
import { healthzRoute } from './healthz.js';
import { testSeedRoute } from './test-seed.js';

export const registerRoutes: FastifyPluginAsyncTypebox = async (fastify) => {
  await fastify.register(authPlugin);
  await fastify.register(realtimeGateway);
  await fastify.register(healthzRoute);
  await fastify.register(testSeedRoute);
  await fastify.register(authRoutes);
  await fastify.register(roomsRoutes);
  await fastify.register(friendsRoutes);
  await fastify.register(blocksRoutes);
  await fastify.register(messagesRoutes);
  await fastify.register(attachmentsRoutes);
  if (config.NODE_ENV === 'test') {
    // Belt-and-suspenders: the plugin also early-returns unless
    // NODE_ENV=test, but guarding here keeps the test-only route out
    // of the prod composition tree entirely.
    await fastify.register(attachmentsTestHelpers);
  }
};

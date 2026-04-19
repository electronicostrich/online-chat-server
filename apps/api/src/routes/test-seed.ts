import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { TestSeedRequestSchema, TestSeedResponseSchema } from 'shared-schemas';

// Per docs/testing-strategy.md §4.3 and docs/api-and-events.md AC-BOOT-00:
// this route is registered only when NODE_ENV is 'test'. In any other env the
// plugin returns without registering anything, so the route is 404. The
// production Dockerfile adds a grep-based belt-and-suspenders check that fails
// the build if any '__test' string leaks into the dist/ output.
export const testSeedRoute: FastifyPluginAsyncTypebox = (fastify) => {
  if (process.env.NODE_ENV !== 'test') return Promise.resolve();

  fastify.post(
    '/__test/seed',
    {
      schema: {
        body: TestSeedRequestSchema,
        response: { 200: TestSeedResponseSchema },
      },
    },
    (req) => {
      if (req.body.strategy === 'upsert') {
        throw fastify.httpErrors.notImplemented(
          'Seed strategy "upsert" is unsupported at Stage-0; entities arrive in WS-02.',
        );
      }
      // Stage-0: no persistent entities yet (apps/api/drizzle/0001_initial.sql
      // provides only _bootstrap_sentinel). Return empty createdIds so the
      // response schema is satisfied; WS-02 fills these out.
      return {
        data: {
          createdIds: {
            users: {},
            rooms: {},
            messages: [],
          },
        },
      };
    },
  );
  return Promise.resolve();
};

import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { TestSeedRequestSchema, TestSeedResponseSchema } from 'shared-schemas';
import { pgSql } from '../db/client.js';
import { insertUser } from '../modules/auth/repository.js';
import { normalizeEmail, normalizeUsername } from '../modules/auth/normalize.js';
import { hashPassword } from '../modules/auth/password.js';

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
    async (req) => {
      const strategy = req.body.strategy ?? 'truncate';
      if (strategy === 'upsert') {
        throw fastify.httpErrors.notImplemented(
          'Seed strategy "upsert" is not yet implemented (WS-08).',
        );
      }

      // Truncate only tables implemented so far (WS-02). WS-03+ entities will
      // extend this list; order respects FK cascades.
      await pgSql.unsafe(
        'TRUNCATE TABLE password_reset_tokens, sessions, users RESTART IDENTITY CASCADE',
      );

      const userIds: Record<string, string> = {};
      for (const u of req.body.users ?? []) {
        const passwordHash = await hashPassword(u.password);
        const row = await insertUser({
          email: u.email.trim(),
          emailCanonical: normalizeEmail(u.email),
          username: u.username.trim(),
          usernameCanonical: normalizeUsername(u.username),
          passwordHash,
        });
        userIds[u.username] = row.id;
      }

      return {
        data: {
          createdIds: {
            users: userIds,
            rooms: {},
            messages: [],
          },
        },
      };
    },
  );
  return Promise.resolve();
};

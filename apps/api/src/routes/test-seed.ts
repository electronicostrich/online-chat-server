import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { Type } from '@sinclair/typebox';
import { TestSeedRequestSchema, TestSeedResponseSchema } from 'shared-schemas';
import { pgSql } from '../db/client.js';
import { insertUser } from '../modules/auth/repository.js';
import { normalizeEmail, normalizeUsername } from '../modules/auth/normalize.js';
import { hashPassword } from '../modules/auth/password.js';
import {
  clearTestResetTokens,
  readTestResetToken,
} from '../modules/auth/test-reset-token-store.js';

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

      // Truncate every table WS-02+WS-03 has created so far. The
      // `CASCADE` clause handles any FKs to these tables that later
      // workstreams add. Order in the list is informational only —
      // CASCADE does the real work.
      await pgSql.unsafe(
        `TRUNCATE TABLE
           room_bans,
           room_invitations,
           room_memberships,
           rooms,
           direct_chat_participants,
           chats,
           friend_requests,
           friendships,
           user_blocks,
           password_reset_tokens,
           sessions,
           users
         RESTART IDENTITY CASCADE`,
      );
      clearTestResetTokens();

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

  // Test-only inspector that returns the latest raw password-reset token for
  // a given email. In real deployments the token travels via SMTP; until the
  // mail transport is wired up (not in WS-02 scope), this gated peek lets
  // Playwright drive the reset flow end-to-end. Guarded by the same
  // NODE_ENV=test registration as /__test/seed; docs/ai-development-guardrails.md
  // §5.7 plus the Dockerfile grep ensure it never ships in prod bundles.
  fastify.get(
    '/__test/last-reset-token',
    {
      schema: {
        querystring: Type.Object({ email: Type.String() }),
        response: {
          200: Type.Object({
            data: Type.Object({ token: Type.Union([Type.String(), Type.Null()]) }),
          }),
        },
      },
    },
    (req) => {
      const emailCanonical = normalizeEmail(req.query.email);
      const token = readTestResetToken(emailCanonical);
      return { data: { token: token ?? null } };
    },
  );

  return Promise.resolve();
};

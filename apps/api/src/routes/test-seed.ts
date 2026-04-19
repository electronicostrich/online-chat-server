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

      if (strategy === 'truncate') {
        // Truncate every table WS-02+WS-03+WS-04 has created so far. The
        // `CASCADE` clause handles any FKs to these tables that later
        // workstreams add. Order in the list is informational only —
        // CASCADE does the real work.
        await pgSql.unsafe(
          `TRUNCATE TABLE
             chat_read_state,
             messages,
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
      }

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

      async function requireUserIdAsync(username: string): Promise<string> {
        const cached = userIds[username];
        if (cached !== undefined) return cached;
        // In 'append' mode the caller may reference users seeded by an
        // earlier call that we weren't asked to re-insert; look them up
        // by canonical username.
        if (strategy === 'append') {
          const usernameCanonical = normalizeUsername(username);
          const rows = await pgSql<{ id: string }[]>`
            SELECT id FROM users WHERE username_canonical = ${usernameCanonical} LIMIT 1
          `;
          const row = rows[0];
          if (row !== undefined) {
            userIds[username] = row.id;
            return row.id;
          }
        }
        throw fastify.httpErrors.badRequest(`seed references unknown user: ${username}`);
      }

      // Friendships (WS-04 needs them for AC-DM-05; AC-DM-02 isn't in the
      // HTTP surface yet, so the test seed is the only writer). The
      // fixture accepts any pair order and reorders to satisfy the
      // `user_low_id < user_high_id` CHECK constraint from migration 0003.
      for (const f of req.body.friendships ?? []) {
        const aId = await requireUserIdAsync(f.userA);
        const bId = await requireUserIdAsync(f.userB);
        const [low, high] = aId < bId ? [aId, bId] : [bId, aId];
        await pgSql`
          INSERT INTO friendships (user_low_id, user_high_id)
          VALUES (${low}, ${high})
          ON CONFLICT DO NOTHING
        `;
      }

      // Room memberships by chat id — lets a spec promote a second user
      // to `admin` for moderation tests without going through the join
      // endpoint (which WS-03 hasn't landed yet).
      for (const m of req.body.roomMembershipsByChatId ?? []) {
        const memberId = await requireUserIdAsync(m.username);
        await pgSql`
          INSERT INTO room_memberships (room_chat_id, user_id, role)
          VALUES (${m.chatId}, ${memberId}, ${m.role})
          ON CONFLICT DO NOTHING
        `;
      }

      // User blocks (WS-04 needs them for the AC-DM-04 rejection path).
      for (const b of req.body.blocks ?? []) {
        const blockerId = await requireUserIdAsync(b.blocker);
        const blockedId = await requireUserIdAsync(b.blocked);
        await pgSql`
          INSERT INTO user_blocks (blocker_user_id, blocked_user_id)
          VALUES (${blockerId}, ${blockedId})
          ON CONFLICT DO NOTHING
        `;
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

  // Test-only inspector used by AC-DM-04 to prove that a rejected DM
  // send leaves no chat row behind. Returns the count of direct chats
  // that contain both users as active participants. Guarded by the
  // NODE_ENV=test registration + the Dockerfile production-bundle grep,
  // same as the other /__test/* routes.
  fastify.get(
    '/__test/direct-chat-count',
    {
      schema: {
        querystring: Type.Object({
          userA: Type.String({ format: 'uuid' }),
          userB: Type.String({ format: 'uuid' }),
        }),
        response: {
          200: Type.Object({ data: Type.Object({ count: Type.Integer() }) }),
        },
      },
    },
    async (req) => {
      const rows = await pgSql<{ count: string | number }[]>`
        SELECT COUNT(*)::int AS count
        FROM chats c
        JOIN direct_chat_participants a ON a.chat_id = c.id AND a.user_id = ${req.query.userA}
        JOIN direct_chat_participants b ON b.chat_id = c.id AND b.user_id = ${req.query.userB}
        WHERE c.type = 'direct' AND c.deleted_at IS NULL
      `;
      const count = Number(rows[0]?.count ?? 0);
      return { data: { count } };
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

import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { Type } from '@sinclair/typebox';
import { pgSql } from '../../db/client.js';

// Test-only helpers for WS-06 specs. Registered only when NODE_ENV=test,
// same discipline as the `/__test/seed` route:
//
// - The plugin early-returns for any other NODE_ENV, so a production
//   bundle contains no routable surface.
// - The Dockerfile prod-stage grep for `__test` would fail the build if
//   this module were accidentally bundled into dist/, per
//   ai-development-guardrails.md §5.7.
//
// These exist because AC-ATT-03 proves a download is rejected after
// the uploader loses room access, and the WS-03 slice that landed
// before WS-06 doesn't yet expose a leave / remove-member / ban
// endpoint. Rather than wait for those endpoints or silently duplicate
// membership-write logic in a spec, we poke the `room_memberships`
// row via a gated helper. When WS-03's moderation endpoints land, the
// spec can be rewritten against them and this helper deleted.
export const attachmentsTestHelpers: FastifyPluginAsyncTypebox = (fastify) => {
  if (process.env.NODE_ENV !== 'test') return Promise.resolve();

  fastify.post(
    '/__test/ws06/expire-membership',
    {
      schema: {
        body: Type.Object({
          chatId: Type.String({ format: 'uuid' }),
          userId: Type.String({ format: 'uuid' }),
        }),
        response: {
          200: Type.Object({ data: Type.Object({ ok: Type.Literal(true) }) }),
        },
      },
    },
    async (req) => {
      await pgSql`
        UPDATE room_memberships
           SET left_at = NOW()
         WHERE room_chat_id = ${req.body.chatId}
           AND user_id = ${req.body.userId}
           AND left_at IS NULL
      `;
      return { data: { ok: true as const } };
    },
  );

  return Promise.resolve();
};

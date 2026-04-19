import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { Type } from '@sinclair/typebox';
import {
  BlockUserResponseSchema,
  ErrorEnvelopeSchema,
} from 'shared-schemas';
import { requireSession } from '../auth/plugin.js';
import { blockUser } from './service.js';

const BlockParamsSchema = Type.Object({
  userId: Type.String({ format: 'uuid' }),
});

export const blocksRoutes: FastifyPluginAsyncTypebox = (fastify) => {
  fastify.post(
    '/blocks/:userId',
    {
      schema: {
        params: BlockParamsSchema,
        response: {
          200: BlockUserResponseSchema,
          400: ErrorEnvelopeSchema,
          401: ErrorEnvelopeSchema,
          404: ErrorEnvelopeSchema,
        },
      },
    },
    async (req, reply) => {
      const session = requireSession(req);
      await blockUser({
        blockerUserId: session.user.id,
        blockedUserId: req.params.userId,
      });
      return reply.status(200).send({
        data: { ok: true, blockedUserId: req.params.userId },
      });
    },
  );
  return Promise.resolve();
};

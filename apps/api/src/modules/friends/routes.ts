import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import {
  CreateFriendRequestResponseSchema,
  CreateFriendRequestSchema,
  ErrorEnvelopeSchema,
} from 'shared-schemas';
import { requireSession } from '../auth/plugin.js';
import { createFriendRequest } from './service.js';

export const friendsRoutes: FastifyPluginAsyncTypebox = (fastify) => {
  fastify.post(
    '/friends/requests',
    {
      schema: {
        body: CreateFriendRequestSchema,
        response: {
          200: CreateFriendRequestResponseSchema,
          400: ErrorEnvelopeSchema,
          401: ErrorEnvelopeSchema,
          403: ErrorEnvelopeSchema,
          404: ErrorEnvelopeSchema,
          409: ErrorEnvelopeSchema,
        },
      },
    },
    async (req, reply) => {
      const session = requireSession(req);
      const { request, recipientUsername } = await createFriendRequest({
        requesterUserId: session.user.id,
        recipientUsername: req.body.recipientUsername,
        ...(req.body.message !== undefined
          ? { message: req.body.message }
          : {}),
      });
      return reply.status(200).send({
        data: {
          request: {
            id: request.id,
            status: request.status,
            recipientUserId: request.recipientUserId,
            recipientUsername,
            createdAt: request.createdAt.toISOString(),
          },
        },
      });
    },
  );
  return Promise.resolve();
};

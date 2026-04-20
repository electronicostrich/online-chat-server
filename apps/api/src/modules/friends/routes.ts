import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { Type } from '@sinclair/typebox';
import {
  AcceptFriendRequestResponseSchema,
  CreateFriendRequestResponseSchema,
  CreateFriendRequestSchema,
  ErrorEnvelopeSchema,
  RejectFriendRequestResponseSchema,
  RemoveFriendResponseSchema,
} from 'shared-schemas';
import { requireSession } from '../auth/plugin.js';
import {
  acceptOpenFriendRequest,
  createFriendRequest,
  rejectOpenFriendRequest,
  removeFriendship,
} from './service.js';

const FriendRequestParamsSchema = Type.Object({
  requestId: Type.String({ format: 'uuid' }),
});

const FriendUserParamsSchema = Type.Object({
  userId: Type.String({ format: 'uuid' }),
});

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

  fastify.post(
    '/friends/requests/:requestId/accept',
    {
      schema: {
        params: FriendRequestParamsSchema,
        response: {
          200: AcceptFriendRequestResponseSchema,
          401: ErrorEnvelopeSchema,
          403: ErrorEnvelopeSchema,
          404: ErrorEnvelopeSchema,
          409: ErrorEnvelopeSchema,
        },
      },
    },
    async (req, reply) => {
      const session = requireSession(req);
      const { request, friendship } = await acceptOpenFriendRequest({
        requestId: req.params.requestId,
        recipientUserId: session.user.id,
      });
      return reply.status(200).send({
        data: {
          request: { id: request.id, status: request.status },
          friendship: {
            id: friendship.id,
            createdAt: friendship.createdAt.toISOString(),
          },
        },
      });
    },
  );

  fastify.post(
    '/friends/requests/:requestId/reject',
    {
      schema: {
        params: FriendRequestParamsSchema,
        response: {
          200: RejectFriendRequestResponseSchema,
          401: ErrorEnvelopeSchema,
          404: ErrorEnvelopeSchema,
          409: ErrorEnvelopeSchema,
        },
      },
    },
    async (req, reply) => {
      const session = requireSession(req);
      const request = await rejectOpenFriendRequest({
        requestId: req.params.requestId,
        recipientUserId: session.user.id,
      });
      return reply.status(200).send({
        data: {
          request: { id: request.id, status: request.status },
        },
      });
    },
  );

  fastify.delete(
    '/friends/:userId',
    {
      schema: {
        params: FriendUserParamsSchema,
        response: {
          200: RemoveFriendResponseSchema,
          400: ErrorEnvelopeSchema,
          401: ErrorEnvelopeSchema,
          404: ErrorEnvelopeSchema,
        },
      },
    },
    async (req, reply) => {
      const session = requireSession(req);
      await removeFriendship({
        callerUserId: session.user.id,
        otherUserId: req.params.userId,
      });
      return reply.status(200).send({ data: { ok: true } });
    },
  );

  return Promise.resolve();
};

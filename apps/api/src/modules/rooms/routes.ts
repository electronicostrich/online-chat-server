import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { Type } from '@sinclair/typebox';
import {
  CreateRoomRequestSchema,
  CreateRoomResponseSchema,
  DeleteRoomResponseSchema,
  ErrorEnvelopeSchema,
} from 'shared-schemas';
import { requireSession } from '../auth/plugin.js';
import { createRoom, deleteRoom, toPublicRoom } from './service.js';

const RoomParamsSchema = Type.Object({
  roomId: Type.String({ format: 'uuid' }),
});

export const roomsRoutes: FastifyPluginAsyncTypebox = (fastify) => {
  fastify.post(
    '/rooms',
    {
      schema: {
        body: CreateRoomRequestSchema,
        response: {
          200: CreateRoomResponseSchema,
          400: ErrorEnvelopeSchema,
          401: ErrorEnvelopeSchema,
          409: ErrorEnvelopeSchema,
        },
      },
    },
    async (req, reply) => {
      const session = requireSession(req);
      const row = await createRoom({
        ownerUserId: session.user.id,
        name: req.body.name,
        ...(req.body.description !== undefined
          ? { description: req.body.description }
          : {}),
        visibility: req.body.visibility,
      });
      return reply.status(200).send({ data: { room: toPublicRoom(row) } });
    },
  );

  fastify.delete(
    '/rooms/:roomId',
    {
      schema: {
        params: RoomParamsSchema,
        response: {
          200: DeleteRoomResponseSchema,
          401: ErrorEnvelopeSchema,
          403: ErrorEnvelopeSchema,
          404: ErrorEnvelopeSchema,
        },
      },
    },
    async (req, reply) => {
      const session = requireSession(req);
      await deleteRoom({
        callerUserId: session.user.id,
        chatId: req.params.roomId,
      });
      return reply.status(200).send({ data: { ok: true } });
    },
  );

  return Promise.resolve();
};

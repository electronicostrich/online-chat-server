import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { Type } from '@sinclair/typebox';
import {
  AcceptRoomInvitationResponseSchema,
  CreateRoomInvitationRequestSchema,
  CreateRoomInvitationResponseSchema,
  CreateRoomRequestSchema,
  CreateRoomResponseSchema,
  DeleteRoomResponseSchema,
  ErrorEnvelopeSchema,
  JoinRoomResponseSchema,
  LeaveRoomResponseSchema,
  ListPublicRoomsQuerySchema,
  ListPublicRoomsResponseSchema,
  ListRoomBansResponseSchema,
  OkResponseSchema,
  RejectRoomInvitationResponseSchema,
} from 'shared-schemas';
import { requireSession } from '../auth/plugin.js';
import {
  acceptInvitation,
  createRoom,
  createRoomInvitation,
  deleteRoom,
  fetchPublicRoomsPage,
  joinPublicRoom,
  leaveRoomAsMember,
  listRoomBans,
  makeMemberAdmin,
  rejectInvitation,
  removeAdminStatus,
  removeMember,
  toPublicRoom,
  unbanRoomUser,
} from './service.js';

const RoomParamsSchema = Type.Object({
  roomId: Type.String({ format: 'uuid' }),
});

const RoomMemberParamsSchema = Type.Object({
  roomId: Type.String({ format: 'uuid' }),
  userId: Type.String({ format: 'uuid' }),
});

const RoomInvitationParamsSchema = Type.Object({
  roomId: Type.String({ format: 'uuid' }),
  invitationId: Type.String({ format: 'uuid' }),
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

  fastify.get(
    '/rooms/public',
    {
      schema: {
        querystring: ListPublicRoomsQuerySchema,
        response: {
          200: ListPublicRoomsResponseSchema,
          400: ErrorEnvelopeSchema,
          401: ErrorEnvelopeSchema,
        },
      },
    },
    async (req, reply) => {
      requireSession(req);
      const result = await fetchPublicRoomsPage({
        ...(req.query.q !== undefined ? { search: req.query.q } : {}),
        ...(req.query.cursor !== undefined ? { cursor: req.query.cursor } : {}),
        ...(req.query.limit !== undefined ? { limit: req.query.limit } : {}),
      });
      return reply.status(200).send({ data: result });
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

  fastify.post(
    '/rooms/:roomId/join',
    {
      schema: {
        params: RoomParamsSchema,
        response: {
          200: JoinRoomResponseSchema,
          401: ErrorEnvelopeSchema,
          403: ErrorEnvelopeSchema,
          404: ErrorEnvelopeSchema,
        },
      },
    },
    async (req, reply) => {
      const session = requireSession(req);
      const result = await joinPublicRoom({
        chatId: req.params.roomId,
        userId: session.user.id,
      });
      return reply
        .status(200)
        .send({ data: { membership: { role: result.role } } });
    },
  );

  fastify.post(
    '/rooms/:roomId/leave',
    {
      schema: {
        params: RoomParamsSchema,
        response: {
          200: LeaveRoomResponseSchema,
          401: ErrorEnvelopeSchema,
          403: ErrorEnvelopeSchema,
          404: ErrorEnvelopeSchema,
        },
      },
    },
    async (req, reply) => {
      const session = requireSession(req);
      await leaveRoomAsMember({
        chatId: req.params.roomId,
        userId: session.user.id,
      });
      return reply.status(200).send({ data: { ok: true } });
    },
  );

  fastify.post(
    '/rooms/:roomId/members/:userId/remove',
    {
      schema: {
        params: RoomMemberParamsSchema,
        response: {
          200: OkResponseSchema,
          400: ErrorEnvelopeSchema,
          401: ErrorEnvelopeSchema,
          403: ErrorEnvelopeSchema,
          404: ErrorEnvelopeSchema,
        },
      },
    },
    async (req, reply) => {
      const session = requireSession(req);
      await removeMember({
        chatId: req.params.roomId,
        actorUserId: session.user.id,
        targetUserId: req.params.userId,
      });
      return reply.status(200).send({ data: { ok: true } });
    },
  );

  fastify.get(
    '/rooms/:roomId/bans',
    {
      schema: {
        params: RoomParamsSchema,
        response: {
          200: ListRoomBansResponseSchema,
          401: ErrorEnvelopeSchema,
          403: ErrorEnvelopeSchema,
          404: ErrorEnvelopeSchema,
        },
      },
    },
    async (req, reply) => {
      const session = requireSession(req);
      const bans = await listRoomBans({
        chatId: req.params.roomId,
        actorUserId: session.user.id,
      });
      return reply.status(200).send({ data: { bans } });
    },
  );

  fastify.delete(
    '/rooms/:roomId/bans/:userId',
    {
      schema: {
        params: RoomMemberParamsSchema,
        response: {
          200: OkResponseSchema,
          401: ErrorEnvelopeSchema,
          403: ErrorEnvelopeSchema,
          404: ErrorEnvelopeSchema,
        },
      },
    },
    async (req, reply) => {
      const session = requireSession(req);
      await unbanRoomUser({
        chatId: req.params.roomId,
        actorUserId: session.user.id,
        targetUserId: req.params.userId,
      });
      return reply.status(200).send({ data: { ok: true } });
    },
  );

  fastify.post(
    '/rooms/:roomId/members/:userId/make-admin',
    {
      schema: {
        params: RoomMemberParamsSchema,
        response: {
          200: OkResponseSchema,
          400: ErrorEnvelopeSchema,
          401: ErrorEnvelopeSchema,
          403: ErrorEnvelopeSchema,
          404: ErrorEnvelopeSchema,
        },
      },
    },
    async (req, reply) => {
      const session = requireSession(req);
      await makeMemberAdmin({
        chatId: req.params.roomId,
        actorUserId: session.user.id,
        targetUserId: req.params.userId,
      });
      return reply.status(200).send({ data: { ok: true } });
    },
  );

  fastify.post(
    '/rooms/:roomId/invitations',
    {
      schema: {
        params: RoomParamsSchema,
        body: CreateRoomInvitationRequestSchema,
        response: {
          200: CreateRoomInvitationResponseSchema,
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
      const invitation = await createRoomInvitation({
        chatId: req.params.roomId,
        actorUserId: session.user.id,
        inviteeUsername: req.body.inviteeUsername,
      });
      return reply.status(200).send({ data: { invitation } });
    },
  );

  fastify.post(
    '/rooms/:roomId/invitations/:invitationId/accept',
    {
      schema: {
        params: RoomInvitationParamsSchema,
        response: {
          200: AcceptRoomInvitationResponseSchema,
          401: ErrorEnvelopeSchema,
          403: ErrorEnvelopeSchema,
          404: ErrorEnvelopeSchema,
          409: ErrorEnvelopeSchema,
        },
      },
    },
    async (req, reply) => {
      const session = requireSession(req);
      const result = await acceptInvitation({
        chatId: req.params.roomId,
        invitationId: req.params.invitationId,
        actorUserId: session.user.id,
      });
      return reply
        .status(200)
        .send({ data: { membership: { role: result.role } } });
    },
  );

  fastify.post(
    '/rooms/:roomId/invitations/:invitationId/reject',
    {
      schema: {
        params: RoomInvitationParamsSchema,
        response: {
          200: RejectRoomInvitationResponseSchema,
          401: ErrorEnvelopeSchema,
          404: ErrorEnvelopeSchema,
          409: ErrorEnvelopeSchema,
        },
      },
    },
    async (req, reply) => {
      const session = requireSession(req);
      await rejectInvitation({
        chatId: req.params.roomId,
        invitationId: req.params.invitationId,
        actorUserId: session.user.id,
      });
      return reply.status(200).send({ data: { ok: true } });
    },
  );

  fastify.post(
    '/rooms/:roomId/members/:userId/remove-admin',
    {
      schema: {
        params: RoomMemberParamsSchema,
        response: {
          200: OkResponseSchema,
          401: ErrorEnvelopeSchema,
          403: ErrorEnvelopeSchema,
          404: ErrorEnvelopeSchema,
        },
      },
    },
    async (req, reply) => {
      const session = requireSession(req);
      await removeAdminStatus({
        chatId: req.params.roomId,
        actorUserId: session.user.id,
        targetUserId: req.params.userId,
      });
      return reply.status(200).send({ data: { ok: true } });
    },
  );

  return Promise.resolve();
};

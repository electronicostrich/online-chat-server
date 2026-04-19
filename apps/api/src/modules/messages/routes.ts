import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { Type } from '@sinclair/typebox';
import {
  AdvanceReadStateRequestSchema,
  AdvanceReadStateResponseSchema,
  DeleteMessageResponseSchema,
  EditMessageRequestSchema,
  EditMessageResponseSchema,
  ErrorEnvelopeSchema,
  ListMessagesQuerySchema,
  ListMessagesResponseSchema,
  ReadStateResponseSchema,
  SendDirectMessageRequestSchema,
  SendDirectMessageResponseSchema,
  SendMessageRequestSchema,
  SendMessageResponseSchema,
} from 'shared-schemas';
import { requireSession } from '../auth/plugin.js';
import {
  advanceReadState,
  deleteMessage,
  editOwnMessage,
  fetchMessagesForChat,
  fetchReadState,
  messageRowToPublic,
  sendDirectMessage,
  sendMessageToChat,
} from './service.js';

const ChatParamsSchema = Type.Object({
  chatId: Type.String({ format: 'uuid' }),
});

const MessageParamsSchema = Type.Object({
  messageId: Type.String({ format: 'uuid' }),
});

const DmParamsSchema = Type.Object({
  userId: Type.String({ format: 'uuid' }),
});

export const messagesRoutes: FastifyPluginAsyncTypebox = (fastify) => {
  fastify.post(
    '/chats/:chatId/messages',
    {
      schema: {
        params: ChatParamsSchema,
        body: SendMessageRequestSchema,
        response: {
          200: SendMessageResponseSchema,
          400: ErrorEnvelopeSchema,
          401: ErrorEnvelopeSchema,
          403: ErrorEnvelopeSchema,
          404: ErrorEnvelopeSchema,
        },
      },
    },
    async (req, reply) => {
      const session = requireSession(req);
      const row = await sendMessageToChat({
        chatId: req.params.chatId,
        senderUserId: session.user.id,
        bodyText: req.body.bodyText,
        replyToMessageId: req.body.replyToMessageId ?? null,
      });
      return reply.status(200).send({ data: { message: messageRowToPublic(row) } });
    },
  );

  fastify.get(
    '/chats/:chatId/messages',
    {
      schema: {
        params: ChatParamsSchema,
        querystring: ListMessagesQuerySchema,
        response: {
          200: ListMessagesResponseSchema,
          401: ErrorEnvelopeSchema,
          403: ErrorEnvelopeSchema,
          404: ErrorEnvelopeSchema,
        },
      },
    },
    async (req, reply) => {
      const session = requireSession(req);
      const result = await fetchMessagesForChat({
        chatId: req.params.chatId,
        callerUserId: session.user.id,
        ...(req.query.beforeSequence !== undefined
          ? { beforeSequence: req.query.beforeSequence }
          : {}),
        ...(req.query.afterSequence !== undefined
          ? { afterSequence: req.query.afterSequence }
          : {}),
        ...(req.query.limit !== undefined ? { limit: req.query.limit } : {}),
      });
      return reply.status(200).send({ data: result });
    },
  );

  fastify.patch(
    '/messages/:messageId',
    {
      schema: {
        params: MessageParamsSchema,
        body: EditMessageRequestSchema,
        response: {
          200: EditMessageResponseSchema,
          400: ErrorEnvelopeSchema,
          401: ErrorEnvelopeSchema,
          403: ErrorEnvelopeSchema,
          404: ErrorEnvelopeSchema,
        },
      },
    },
    async (req, reply) => {
      const session = requireSession(req);
      const row = await editOwnMessage({
        messageId: req.params.messageId,
        authorUserId: session.user.id,
        bodyText: req.body.bodyText,
      });
      return reply.status(200).send({ data: { message: messageRowToPublic(row) } });
    },
  );

  fastify.delete(
    '/messages/:messageId',
    {
      schema: {
        params: MessageParamsSchema,
        response: {
          200: DeleteMessageResponseSchema,
          401: ErrorEnvelopeSchema,
          403: ErrorEnvelopeSchema,
          404: ErrorEnvelopeSchema,
        },
      },
    },
    async (req, reply) => {
      const session = requireSession(req);
      await deleteMessage({
        messageId: req.params.messageId,
        callerUserId: session.user.id,
      });
      return reply.status(200).send({ data: { ok: true } });
    },
  );

  fastify.post(
    '/dm/:userId/messages',
    {
      schema: {
        params: DmParamsSchema,
        body: SendDirectMessageRequestSchema,
        response: {
          200: SendDirectMessageResponseSchema,
          400: ErrorEnvelopeSchema,
          401: ErrorEnvelopeSchema,
          403: ErrorEnvelopeSchema,
          404: ErrorEnvelopeSchema,
        },
      },
    },
    async (req, reply) => {
      const session = requireSession(req);
      const result = await sendDirectMessage({
        senderUserId: session.user.id,
        recipientUserId: req.params.userId,
        bodyText: req.body.bodyText,
        replyToMessageId: req.body.replyToMessageId ?? null,
      });
      return reply.status(200).send({
        data: {
          chat: { id: result.chatId, created: result.chatCreated },
          message: messageRowToPublic(result.message),
        },
      });
    },
  );

  fastify.post(
    '/chats/:chatId/read',
    {
      schema: {
        params: ChatParamsSchema,
        body: AdvanceReadStateRequestSchema,
        response: {
          200: AdvanceReadStateResponseSchema,
          401: ErrorEnvelopeSchema,
          403: ErrorEnvelopeSchema,
          404: ErrorEnvelopeSchema,
        },
      },
    },
    async (req, reply) => {
      const session = requireSession(req);
      const result = await advanceReadState({
        chatId: req.params.chatId,
        userId: session.user.id,
        readUpToSequence: req.body.readUpToSequence,
      });
      return reply.status(200).send({ data: result });
    },
  );

  fastify.get(
    '/chats/:chatId/read-state',
    {
      schema: {
        params: ChatParamsSchema,
        response: {
          200: ReadStateResponseSchema,
          401: ErrorEnvelopeSchema,
          403: ErrorEnvelopeSchema,
          404: ErrorEnvelopeSchema,
        },
      },
    },
    async (req, reply) => {
      const session = requireSession(req);
      const result = await fetchReadState({
        chatId: req.params.chatId,
        userId: session.user.id,
      });
      return reply.status(200).send({ data: result });
    },
  );

  return Promise.resolve();
};

import { Type, type Static } from '@sinclair/typebox';
import { MessagePublicSchema } from './messages.js';

// The server -> client event envelope from api-and-events.md §6.3. The
// `type` literal is the discriminator; individual event payload shapes
// live under §6.4 and are declared below alongside their envelope.
export const EventEnvelopeBaseSchema = Type.Object({
  eventId: Type.String({ format: 'uuid' }),
  type: Type.String(),
  occurredAt: Type.String({ format: 'date-time' }),
  payload: Type.Unknown(),
});
export type EventEnvelopeBase = Static<typeof EventEnvelopeBaseSchema>;

export const MessageCreatedPayloadSchema = Type.Object({
  chatId: Type.String({ format: 'uuid' }),
  headSequence: Type.Integer({ minimum: 1 }),
  message: MessagePublicSchema,
});
export type MessageCreatedPayload = Static<typeof MessageCreatedPayloadSchema>;

export const MessageCreatedEventSchema = Type.Object({
  eventId: Type.String({ format: 'uuid' }),
  type: Type.Literal('message.created'),
  occurredAt: Type.String({ format: 'date-time' }),
  payload: MessageCreatedPayloadSchema,
});
export type MessageCreatedEvent = Static<typeof MessageCreatedEventSchema>;

export const MessageEditedPayloadSchema = Type.Object({
  chatId: Type.String({ format: 'uuid' }),
  messageId: Type.String({ format: 'uuid' }),
  sequence: Type.Integer({ minimum: 1 }),
  bodyText: Type.String(),
  editedAt: Type.String({ format: 'date-time' }),
});
export type MessageEditedPayload = Static<typeof MessageEditedPayloadSchema>;

export const MessageEditedEventSchema = Type.Object({
  eventId: Type.String({ format: 'uuid' }),
  type: Type.Literal('message.edited'),
  occurredAt: Type.String({ format: 'date-time' }),
  payload: MessageEditedPayloadSchema,
});
export type MessageEditedEvent = Static<typeof MessageEditedEventSchema>;

export const MessageDeletedPayloadSchema = Type.Object({
  chatId: Type.String({ format: 'uuid' }),
  messageId: Type.String({ format: 'uuid' }),
  sequence: Type.Integer({ minimum: 1 }),
  deletedAt: Type.String({ format: 'date-time' }),
});
export type MessageDeletedPayload = Static<typeof MessageDeletedPayloadSchema>;

export const MessageDeletedEventSchema = Type.Object({
  eventId: Type.String({ format: 'uuid' }),
  type: Type.Literal('message.deleted'),
  occurredAt: Type.String({ format: 'date-time' }),
  payload: MessageDeletedPayloadSchema,
});
export type MessageDeletedEvent = Static<typeof MessageDeletedEventSchema>;

export const ReadstateUpdatedPayloadSchema = Type.Object({
  chatId: Type.String({ format: 'uuid' }),
  userId: Type.String({ format: 'uuid' }),
  lastReadSequence: Type.Integer({ minimum: 0 }),
});
export type ReadstateUpdatedPayload = Static<typeof ReadstateUpdatedPayloadSchema>;

export const ReadstateUpdatedEventSchema = Type.Object({
  eventId: Type.String({ format: 'uuid' }),
  type: Type.Literal('readstate.updated'),
  occurredAt: Type.String({ format: 'date-time' }),
  payload: ReadstateUpdatedPayloadSchema,
});
export type ReadstateUpdatedEvent = Static<typeof ReadstateUpdatedEventSchema>;

export const SessionRevokedPayloadSchema = Type.Object({
  sessionId: Type.String({ format: 'uuid' }),
});
export type SessionRevokedPayload = Static<typeof SessionRevokedPayloadSchema>;

export const SessionRevokedEventSchema = Type.Object({
  eventId: Type.String({ format: 'uuid' }),
  type: Type.Literal('session.revoked'),
  occurredAt: Type.String({ format: 'date-time' }),
  payload: SessionRevokedPayloadSchema,
});
export type SessionRevokedEvent = Static<typeof SessionRevokedEventSchema>;

// Client -> server commands from api-and-events.md §6.2. The base shape is
// common; the union of concrete commands is below.
export const ChatSubscribeCommandSchema = Type.Object({
  id: Type.String({ minLength: 1, maxLength: 128 }),
  type: Type.Literal('chat.subscribe'),
  payload: Type.Object({
    chatId: Type.String({ format: 'uuid' }),
  }),
});
export type ChatSubscribeCommand = Static<typeof ChatSubscribeCommandSchema>;

export const ChatUnsubscribeCommandSchema = Type.Object({
  id: Type.String({ minLength: 1, maxLength: 128 }),
  type: Type.Literal('chat.unsubscribe'),
  payload: Type.Object({
    chatId: Type.String({ format: 'uuid' }),
  }),
});
export type ChatUnsubscribeCommand = Static<typeof ChatUnsubscribeCommandSchema>;

export const ClientCommandSchema = Type.Union([
  ChatSubscribeCommandSchema,
  ChatUnsubscribeCommandSchema,
]);
export type ClientCommand = Static<typeof ClientCommandSchema>;

// Close reason codes the realtime gateway uses. WebSocket close codes are
// constrained to 4000-4999 for application-defined reasons (RFC 6455
// §7.4.2). The numbers here are stable so clients can react without
// parsing the reason string.
export const WS_CLOSE_CODES = {
  UNAUTHENTICATED: 4401,
  CSRF_FAILED: 4403,
  SESSION_REVOKED: 4440,
  SLOW_CONSUMER: 4408,
} as const;
export type WsCloseCode = (typeof WS_CLOSE_CODES)[keyof typeof WS_CLOSE_CODES];

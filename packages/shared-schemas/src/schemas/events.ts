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

// AC-PRES-01..04. Presence is an aggregate per-user derived state:
// `online` if any live tab has recent activity, `afk` if at least one
// live tab remains but none is active, `offline` if no live tab remains.
// The concrete thresholds live on the server side; the wire shape only
// needs the discriminator.
export const PresenceStateSchema = Type.Union([
  Type.Literal('online'),
  Type.Literal('afk'),
  Type.Literal('offline'),
]);
export type PresenceState = Static<typeof PresenceStateSchema>;

export const PresenceUpdatedPayloadSchema = Type.Object({
  userId: Type.String({ format: 'uuid' }),
  presence: PresenceStateSchema,
});
export type PresenceUpdatedPayload = Static<typeof PresenceUpdatedPayloadSchema>;

export const PresenceUpdatedEventSchema = Type.Object({
  eventId: Type.String({ format: 'uuid' }),
  type: Type.Literal('presence.updated'),
  occurredAt: Type.String({ format: 'date-time' }),
  payload: PresenceUpdatedPayloadSchema,
});
export type PresenceUpdatedEvent = Static<typeof PresenceUpdatedEventSchema>;

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

// `presence.heartbeat` is the "I'm still here" liveness ping the client
// sends on a short cadence so the server can tell the tab from a
// hibernated one. It does NOT claim interaction — a tab that's open but
// untouched for 60s still gets aggregated as AFK.
export const PresenceHeartbeatCommandSchema = Type.Object({
  id: Type.String({ minLength: 1, maxLength: 128 }),
  type: Type.Literal('presence.heartbeat'),
  payload: Type.Object({}),
});
export type PresenceHeartbeatCommand = Static<typeof PresenceHeartbeatCommandSchema>;

// `presence.activity` is emitted on user interaction (pointer, key,
// scroll, focus, compose). It implies a heartbeat too — a tab actively
// interacting is definitely live.
export const PresenceActivityCommandSchema = Type.Object({
  id: Type.String({ minLength: 1, maxLength: 128 }),
  type: Type.Literal('presence.activity'),
  payload: Type.Object({}),
});
export type PresenceActivityCommand = Static<typeof PresenceActivityCommandSchema>;

export const ChatUnsubscribeCommandSchema = Type.Object({
  id: Type.String({ minLength: 1, maxLength: 128 }),
  type: Type.Literal('chat.unsubscribe'),
  payload: Type.Object({
    chatId: Type.String({ format: 'uuid' }),
  }),
});
export type ChatUnsubscribeCommand = Static<typeof ChatUnsubscribeCommandSchema>;

// AC-RT-02 / AC-RT-04. Client sends `sync.request` on reconnect (or on
// demand when a gap is detected) with its last known contiguous sequence
// and last known read sequence per chat. Server answers with per-chat
// advice so the client can reconcile local state with durable history.
// The per-request cap of 200 chats is enforced by the handler; TypeBox
// captures the structural contract here.
export const SYNC_REQUEST_MAX_CHATS = 200;

export const SyncRequestChatEntrySchema = Type.Object({
  chatId: Type.String({ format: 'uuid' }),
  lastKnownContiguousSequence: Type.Integer({ minimum: 0 }),
  lastKnownReadSequence: Type.Integer({ minimum: 0 }),
});
export type SyncRequestChatEntry = Static<typeof SyncRequestChatEntrySchema>;

export const SyncRequestCommandSchema = Type.Object({
  id: Type.String({ minLength: 1, maxLength: 128 }),
  type: Type.Literal('sync.request'),
  payload: Type.Object({
    chats: Type.Array(SyncRequestChatEntrySchema, {
      minItems: 0,
      maxItems: SYNC_REQUEST_MAX_CHATS,
    }),
  }),
});
export type SyncRequestCommand = Static<typeof SyncRequestCommandSchema>;

export const SyncAdviceSchema = Type.Union([
  Type.Literal('in-sync'),
  Type.Literal('fetch-history'),
  Type.Literal('chat-inaccessible'),
]);
export type SyncAdvice = Static<typeof SyncAdviceSchema>;

export const SyncResponseChatEntrySchema = Type.Object({
  chatId: Type.String({ format: 'uuid' }),
  headSequence: Type.Integer({ minimum: 0 }),
  serverReadSequence: Type.Integer({ minimum: 0 }),
  advice: SyncAdviceSchema,
  rangeHint: Type.Optional(
    Type.Object({
      fromSequence: Type.Integer({ minimum: 1 }),
      toSequence: Type.Integer({ minimum: 1 }),
    }),
  ),
});
export type SyncResponseChatEntry = Static<typeof SyncResponseChatEntrySchema>;

export const SyncResponsePayloadSchema = Type.Object({
  replyToCommandId: Type.String({ minLength: 1, maxLength: 128 }),
  chats: Type.Array(SyncResponseChatEntrySchema),
});
export type SyncResponsePayload = Static<typeof SyncResponsePayloadSchema>;

export const SyncResponseEventSchema = Type.Object({
  eventId: Type.String({ format: 'uuid' }),
  type: Type.Literal('sync.response'),
  occurredAt: Type.String({ format: 'date-time' }),
  payload: SyncResponsePayloadSchema,
});
export type SyncResponseEvent = Static<typeof SyncResponseEventSchema>;

export const ClientCommandSchema = Type.Union([
  ChatSubscribeCommandSchema,
  ChatUnsubscribeCommandSchema,
  SyncRequestCommandSchema,
  PresenceHeartbeatCommandSchema,
  PresenceActivityCommandSchema,
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
  // AC-PRES-04: a tab that has stopped sending heartbeats is marked
  // stale by the presence sweep and its socket closed with this code
  // so the client can distinguish hibernation drop from a network
  // error (which surfaces as 1006) when it reconnects.
  STALE_CONNECTION: 4410,
} as const;
export type WsCloseCode = (typeof WS_CLOSE_CODES)[keyof typeof WS_CLOSE_CODES];

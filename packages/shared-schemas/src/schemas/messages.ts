import { Type, type Static } from '@sinclair/typebox';
import { SuccessEnvelope } from './envelopes.js';
import { MESSAGE_MAX_BYTES } from '../constants/limits.js';

// Note: `maxLength` is a character count on the JSON-Schema side; the
// real byte-based limit from AC-MSG-02 is enforced in the service so that
// multibyte characters are measured correctly. The schema's `maxLength`
// here is a cheap up-front guard that can never be tighter than
// MESSAGE_MAX_BYTES bytes once encoded in UTF-8.
export const MESSAGE_BODY_MAX_LENGTH = MESSAGE_MAX_BYTES;

export const MessageKindSchema = Type.Union([
  Type.Literal('text'),
  Type.Literal('system'),
  Type.Literal('attachment'),
]);
export type MessageKind = Static<typeof MessageKindSchema>;

export const MessagePublicSchema = Type.Object({
  id: Type.String({ format: 'uuid' }),
  chatId: Type.String({ format: 'uuid' }),
  sequence: Type.Integer({ minimum: 1 }),
  authorUserId: Type.String({ format: 'uuid' }),
  kind: MessageKindSchema,
  bodyText: Type.Union([Type.String(), Type.Null()]),
  replyToMessageId: Type.Union([Type.String({ format: 'uuid' }), Type.Null()]),
  createdAt: Type.String({ format: 'date-time' }),
  editedAt: Type.Union([Type.String({ format: 'date-time' }), Type.Null()]),
  deletedAt: Type.Union([Type.String({ format: 'date-time' }), Type.Null()]),
});
export type MessagePublic = Static<typeof MessagePublicSchema>;

export const SendMessageRequestSchema = Type.Object(
  {
    bodyText: Type.String({ minLength: 1, maxLength: MESSAGE_BODY_MAX_LENGTH }),
    replyToMessageId: Type.Optional(Type.Union([Type.String({ format: 'uuid' }), Type.Null()])),
  },
  { additionalProperties: false },
);
export type SendMessageRequest = Static<typeof SendMessageRequestSchema>;

export const SendMessageResponseSchema = SuccessEnvelope(
  Type.Object({ message: MessagePublicSchema }),
);
export type SendMessageResponse = Static<typeof SendMessageResponseSchema>;

export const EditMessageRequestSchema = Type.Object(
  {
    bodyText: Type.String({ minLength: 1, maxLength: MESSAGE_BODY_MAX_LENGTH }),
  },
  { additionalProperties: false },
);
export type EditMessageRequest = Static<typeof EditMessageRequestSchema>;

export const EditMessageResponseSchema = SuccessEnvelope(
  Type.Object({ message: MessagePublicSchema }),
);
export type EditMessageResponse = Static<typeof EditMessageResponseSchema>;

export const DeleteMessageResponseSchema = SuccessEnvelope(Type.Object({ ok: Type.Literal(true) }));
export type DeleteMessageResponse = Static<typeof DeleteMessageResponseSchema>;

export const ListMessagesQuerySchema = Type.Object(
  {
    beforeSequence: Type.Optional(Type.Integer({ minimum: 1 })),
    afterSequence: Type.Optional(Type.Integer({ minimum: 0 })),
    limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
  },
  { additionalProperties: false },
);
export type ListMessagesQuery = Static<typeof ListMessagesQuerySchema>;

export const ListMessagesResponseSchema = SuccessEnvelope(
  Type.Object({
    chatId: Type.String({ format: 'uuid' }),
    headSequence: Type.Integer({ minimum: 0 }),
    messages: Type.Array(MessagePublicSchema),
  }),
);
export type ListMessagesResponse = Static<typeof ListMessagesResponseSchema>;

export const SendDirectMessageRequestSchema = SendMessageRequestSchema;
export type SendDirectMessageRequest = Static<typeof SendDirectMessageRequestSchema>;

export const SendDirectMessageResponseSchema = SuccessEnvelope(
  Type.Object({
    chat: Type.Object({
      id: Type.String({ format: 'uuid' }),
      created: Type.Boolean(),
    }),
    message: MessagePublicSchema,
  }),
);
export type SendDirectMessageResponse = Static<typeof SendDirectMessageResponseSchema>;

export const AdvanceReadStateRequestSchema = Type.Object(
  {
    readUpToSequence: Type.Integer({ minimum: 0 }),
  },
  { additionalProperties: false },
);
export type AdvanceReadStateRequest = Static<typeof AdvanceReadStateRequestSchema>;

export const AdvanceReadStateResponseSchema = SuccessEnvelope(
  Type.Object({
    chatId: Type.String({ format: 'uuid' }),
    lastReadSequence: Type.Integer({ minimum: 0 }),
  }),
);
export type AdvanceReadStateResponse = Static<typeof AdvanceReadStateResponseSchema>;

export const ReadStateResponseSchema = SuccessEnvelope(
  Type.Object({
    chatId: Type.String({ format: 'uuid' }),
    lastReadSequence: Type.Integer({ minimum: 0 }),
    headSequence: Type.Integer({ minimum: 0 }),
    hasUnread: Type.Boolean(),
  }),
);
export type ReadStateResponse = Static<typeof ReadStateResponseSchema>;

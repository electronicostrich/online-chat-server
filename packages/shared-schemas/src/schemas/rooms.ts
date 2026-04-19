import { Type, type Static } from '@sinclair/typebox';
import { SuccessEnvelope } from './envelopes.js';
import {
  ROOM_NAME_MAX_LENGTH,
  ROOM_NAME_MIN_LENGTH,
} from '../constants/limits.js';

export const RoomVisibilitySchema = Type.Union([
  Type.Literal('public'),
  Type.Literal('private'),
]);
export type RoomVisibility = Static<typeof RoomVisibilitySchema>;

export const RoomRoleSchema = Type.Union([
  Type.Literal('owner'),
  Type.Literal('admin'),
  Type.Literal('member'),
]);
export type RoomRole = Static<typeof RoomRoleSchema>;

// Shape for the client-visible room record. Keep it narrow — membership
// and presence live on separate endpoints.
export const RoomPublicSchema = Type.Object({
  chatId: Type.String({ format: 'uuid' }),
  name: Type.String(),
  description: Type.Union([Type.String(), Type.Null()]),
  visibility: RoomVisibilitySchema,
  ownerUserId: Type.String({ format: 'uuid' }),
  createdAt: Type.String({ format: 'date-time' }),
});
export type RoomPublic = Static<typeof RoomPublicSchema>;

export const CreateRoomRequestSchema = Type.Object(
  {
    name: Type.String({
      minLength: ROOM_NAME_MIN_LENGTH,
      maxLength: ROOM_NAME_MAX_LENGTH,
    }),
    description: Type.Optional(Type.String({ maxLength: 500 })),
    visibility: RoomVisibilitySchema,
  },
  { additionalProperties: false },
);
export type CreateRoomRequest = Static<typeof CreateRoomRequestSchema>;

export const CreateRoomResponseDataSchema = Type.Object({
  room: RoomPublicSchema,
});
export const CreateRoomResponseSchema = SuccessEnvelope(
  CreateRoomResponseDataSchema,
);
export type CreateRoomResponse = Static<typeof CreateRoomResponseSchema>;

export const DeleteRoomResponseSchema = SuccessEnvelope(
  Type.Object({ ok: Type.Literal(true) }),
);
export type DeleteRoomResponse = Static<typeof DeleteRoomResponseSchema>;

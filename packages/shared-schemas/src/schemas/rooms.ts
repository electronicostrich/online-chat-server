import { Type, type Static } from '@sinclair/typebox';
import { SuccessEnvelope } from './envelopes.js';
import {
  PAGINATION_CURSOR_DEFAULT_LIMIT,
  PAGINATION_CURSOR_MAX_LIMIT,
  ROOM_DESCRIPTION_MAX_LENGTH,
  ROOM_NAME_MAX_LENGTH,
  ROOM_NAME_MIN_LENGTH,
  USERNAME_MAX_LENGTH,
  USERNAME_MIN_LENGTH,
} from '../constants/limits.js';

const UsernameSchema = Type.String({
  minLength: USERNAME_MIN_LENGTH,
  maxLength: USERNAME_MAX_LENGTH,
  pattern: '^[a-zA-Z0-9._-]+$',
});

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
    description: Type.Optional(
      Type.String({ maxLength: ROOM_DESCRIPTION_MAX_LENGTH }),
    ),
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

// Public-room catalog list item. `memberCount` is the current count of
// active `room_memberships` rows for the chat, computed at list time.
export const PublicRoomCatalogEntrySchema = Type.Object({
  chatId: Type.String({ format: 'uuid' }),
  name: Type.String(),
  description: Type.Union([Type.String(), Type.Null()]),
  memberCount: Type.Integer({ minimum: 0 }),
  createdAt: Type.String({ format: 'date-time' }),
});
export type PublicRoomCatalogEntry = Static<typeof PublicRoomCatalogEntrySchema>;

export const ListPublicRoomsQuerySchema = Type.Object(
  {
    q: Type.Optional(Type.String({ maxLength: ROOM_NAME_MAX_LENGTH })),
    limit: Type.Optional(
      Type.Integer({
        minimum: 1,
        maximum: PAGINATION_CURSOR_MAX_LIMIT,
        default: PAGINATION_CURSOR_DEFAULT_LIMIT,
      }),
    ),
    // Cursor is an opaque base64url string wrapping (createdAt, chatId)
    // so paging stays monotonic even when new rooms land between pages.
    cursor: Type.Optional(Type.String({ maxLength: 256 })),
  },
  { additionalProperties: false },
);
export type ListPublicRoomsQuery = Static<typeof ListPublicRoomsQuerySchema>;

export const ListPublicRoomsResponseSchema = SuccessEnvelope(
  Type.Object({
    rooms: Type.Array(PublicRoomCatalogEntrySchema),
    nextCursor: Type.Union([Type.String(), Type.Null()]),
  }),
);
export type ListPublicRoomsResponse = Static<typeof ListPublicRoomsResponseSchema>;

export const JoinRoomResponseSchema = SuccessEnvelope(
  Type.Object({
    membership: Type.Object({
      role: RoomRoleSchema,
    }),
  }),
);
export type JoinRoomResponse = Static<typeof JoinRoomResponseSchema>;

export const LeaveRoomResponseSchema = SuccessEnvelope(
  Type.Object({ ok: Type.Literal(true) }),
);
export type LeaveRoomResponse = Static<typeof LeaveRoomResponseSchema>;

export const RoomBanEntrySchema = Type.Object({
  userId: Type.String({ format: 'uuid' }),
  username: UsernameSchema,
  bannedByUserId: Type.Union([Type.String({ format: 'uuid' }), Type.Null()]),
  bannedByUsername: Type.Union([UsernameSchema, Type.Null()]),
  createdAt: Type.String({ format: 'date-time' }),
});
export type RoomBanEntry = Static<typeof RoomBanEntrySchema>;

export const ListRoomBansResponseSchema = SuccessEnvelope(
  Type.Object({
    bans: Type.Array(RoomBanEntrySchema),
  }),
);
export type ListRoomBansResponse = Static<typeof ListRoomBansResponseSchema>;

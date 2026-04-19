import { Type, type Static } from '@sinclair/typebox';
import { SuccessEnvelope } from './envelopes.js';

const UserSeedSchema = Type.Object({
  username: Type.String(),
  email: Type.String(),
  password: Type.String(),
});

const RoomSeedSchema = Type.Object({
  name: Type.String(),
  ownerUsername: Type.String(),
  visibility: Type.Union([Type.Literal('public'), Type.Literal('private')]),
});

const MembershipSeedSchema = Type.Object({
  roomName: Type.String(),
  username: Type.String(),
  role: Type.Union([Type.Literal('member'), Type.Literal('moderator'), Type.Literal('owner')]),
});

// Distinct from `memberships` because it identifies the room by its
// `chat_id` (returned from `POST /rooms`) rather than by name. The two
// shapes are not merged so a spec author can't accidentally reference a
// non-existent room name and have it silently no-op.
const RoomMembershipByChatIdSeedSchema = Type.Object({
  chatId: Type.String({ format: 'uuid' }),
  username: Type.String(),
  role: Type.Union([Type.Literal('member'), Type.Literal('admin'), Type.Literal('owner')]),
});

const FriendshipSeedSchema = Type.Object({
  userA: Type.String(),
  userB: Type.String(),
});

const BlockSeedSchema = Type.Object({
  blocker: Type.String(),
  blocked: Type.String(),
});

const ChatRefSchema = Type.Union([
  Type.Object({ roomName: Type.String() }),
  Type.Object({ dm: Type.Tuple([Type.String(), Type.String()]) }),
]);

const MessageSeedSchema = Type.Object({
  chatRef: ChatRefSchema,
  authorUsername: Type.String(),
  bodyText: Type.String(),
});

export const TestSeedRequestSchema = Type.Object({
  strategy: Type.Optional(
    Type.Union([
      Type.Literal('truncate'),
      Type.Literal('upsert'),
      // 'append' runs no TRUNCATE and inserts the supplied fixture rows
      // with ON CONFLICT DO NOTHING. Used by specs that need to add
      // room memberships or friendships after an earlier /__test/seed
      // truncate + subsequent HTTP-level setup (e.g., room create).
      Type.Literal('append'),
    ]),
  ),
  users: Type.Optional(Type.Array(UserSeedSchema)),
  rooms: Type.Optional(Type.Array(RoomSeedSchema)),
  memberships: Type.Optional(Type.Array(MembershipSeedSchema)),
  roomMembershipsByChatId: Type.Optional(Type.Array(RoomMembershipByChatIdSeedSchema)),
  friendships: Type.Optional(Type.Array(FriendshipSeedSchema)),
  blocks: Type.Optional(Type.Array(BlockSeedSchema)),
  messages: Type.Optional(Type.Array(MessageSeedSchema)),
});
export type TestSeedRequest = Static<typeof TestSeedRequestSchema>;

export const TestSeedResponseDataSchema = Type.Object({
  createdIds: Type.Object({
    users: Type.Record(Type.String(), Type.String()),
    rooms: Type.Record(Type.String(), Type.String()),
    messages: Type.Array(Type.String()),
  }),
});

export const TestSeedResponseSchema = SuccessEnvelope(TestSeedResponseDataSchema);
export type TestSeedResponse = Static<typeof TestSeedResponseSchema>;

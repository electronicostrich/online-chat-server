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
  strategy: Type.Optional(Type.Union([Type.Literal('truncate'), Type.Literal('upsert')])),
  users: Type.Optional(Type.Array(UserSeedSchema)),
  rooms: Type.Optional(Type.Array(RoomSeedSchema)),
  memberships: Type.Optional(Type.Array(MembershipSeedSchema)),
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

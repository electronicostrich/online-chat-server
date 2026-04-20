import { Type, type Static } from '@sinclair/typebox';
import { SuccessEnvelope } from './envelopes.js';
import {
  FRIEND_REQUEST_MESSAGE_MAX_LENGTH,
  USERNAME_MAX_LENGTH,
  USERNAME_MIN_LENGTH,
} from '../constants/limits.js';

// Shared by both the inbound request body and the outbound response so
// pattern/length constraints stay aligned if they ever evolve.
const UsernameSchema = Type.String({
  minLength: USERNAME_MIN_LENGTH,
  maxLength: USERNAME_MAX_LENGTH,
  pattern: '^[a-zA-Z0-9._-]+$',
});

export const FriendRequestStatusSchema = Type.Union([
  Type.Literal('open'),
  Type.Literal('accepted'),
  Type.Literal('rejected'),
  Type.Literal('cancelled'),
  Type.Literal('expired'),
]);
export type FriendRequestStatus = Static<typeof FriendRequestStatusSchema>;

export const CreateFriendRequestSchema = Type.Object(
  {
    recipientUsername: UsernameSchema,
    message: Type.Optional(
      Type.String({ maxLength: FRIEND_REQUEST_MESSAGE_MAX_LENGTH }),
    ),
  },
  { additionalProperties: false },
);
export type CreateFriendRequestBody = Static<typeof CreateFriendRequestSchema>;

export const FriendRequestPublicSchema = Type.Object({
  id: Type.String({ format: 'uuid' }),
  status: FriendRequestStatusSchema,
  recipientUserId: Type.String({ format: 'uuid' }),
  recipientUsername: UsernameSchema,
  createdAt: Type.String({ format: 'date-time' }),
});

export const CreateFriendRequestResponseDataSchema = Type.Object({
  request: FriendRequestPublicSchema,
});
export const CreateFriendRequestResponseSchema = SuccessEnvelope(
  CreateFriendRequestResponseDataSchema,
);
export type CreateFriendRequestResponse = Static<
  typeof CreateFriendRequestResponseSchema
>;

// Accept/Reject response — the caller already knows which request id
// they're touching, so we just report the canonical closed state.
export const FriendRequestClosedSchema = Type.Object({
  id: Type.String({ format: 'uuid' }),
  status: FriendRequestStatusSchema,
});

export const AcceptFriendRequestResponseSchema = SuccessEnvelope(
  Type.Object({
    request: FriendRequestClosedSchema,
    friendship: Type.Object({
      id: Type.String({ format: 'uuid' }),
      createdAt: Type.String({ format: 'date-time' }),
    }),
  }),
);
export type AcceptFriendRequestResponse = Static<
  typeof AcceptFriendRequestResponseSchema
>;

export const RejectFriendRequestResponseSchema = SuccessEnvelope(
  Type.Object({
    request: FriendRequestClosedSchema,
  }),
);
export type RejectFriendRequestResponse = Static<
  typeof RejectFriendRequestResponseSchema
>;

export const RemoveFriendResponseSchema = SuccessEnvelope(
  Type.Object({ ok: Type.Literal(true) }),
);
export type RemoveFriendResponse = Static<typeof RemoveFriendResponseSchema>;

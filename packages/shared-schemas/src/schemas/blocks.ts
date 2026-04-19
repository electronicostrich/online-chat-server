import { Type, type Static } from '@sinclair/typebox';
import { SuccessEnvelope } from './envelopes.js';

// Block is fire-and-forget: the path segment carries the target userId.
// Response only needs to confirm the block is active so the caller can
// update the UI.
export const BlockUserResponseDataSchema = Type.Object({
  ok: Type.Literal(true),
  blockedUserId: Type.String({ format: 'uuid' }),
});
export const BlockUserResponseSchema = SuccessEnvelope(
  BlockUserResponseDataSchema,
);
export type BlockUserResponse = Static<typeof BlockUserResponseSchema>;

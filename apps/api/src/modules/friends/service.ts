import { ErrorCodes } from 'shared-schemas';
import type { FriendRequestRow } from '../../db/schema/friend-requests.js';
import type { FriendshipRow } from '../../db/schema/friendships.js';
import { normalizeUsername } from '../auth/normalize.js';
import { FriendError } from './errors.js';
import {
  acceptFriendRequest,
  endFriendship,
  extractPgConstraint,
  findActiveBlockBetween,
  findActiveFriendshipBetween,
  findFriendRequestById,
  findOpenFriendRequest,
  findUserByUsernameCanonical,
  insertFriendRequest,
  isUniqueViolation,
  rejectFriendRequest,
} from './repository.js';

export interface CreateFriendRequestInput {
  requesterUserId: string;
  recipientUsername: string;
  message?: string;
}

export interface CreateFriendRequestResult {
  request: FriendRequestRow;
  recipientUsername: string;
}

export async function createFriendRequest(
  input: CreateFriendRequestInput,
): Promise<CreateFriendRequestResult> {
  const recipientCanonical = normalizeUsername(input.recipientUsername);
  if (recipientCanonical.length === 0) {
    throw new FriendError(
      ErrorCodes.VALIDATION_ERROR,
      400,
      'Recipient username cannot be empty.',
      { field: 'recipientUsername' },
    );
  }
  const recipient = await findUserByUsernameCanonical(recipientCanonical);
  if (recipient === undefined) {
    throw new FriendError(
      ErrorCodes.NOT_FOUND,
      404,
      'Recipient user not found.',
    );
  }
  if (recipient.id === input.requesterUserId) {
    throw new FriendError(
      ErrorCodes.VALIDATION_ERROR,
      400,
      'Cannot send a friend request to yourself.',
      { field: 'recipientUsername' },
    );
  }
  if (await findActiveBlockBetween(input.requesterUserId, recipient.id)) {
    // A block in either direction blocks DM *and* friend requests. The
    // requester gets a generic code so they can't probe for a block.
    throw new FriendError(
      ErrorCodes.DM_NOT_ALLOWED,
      403,
      'Cannot send a friend request to this user.',
    );
  }
  if (await findActiveFriendshipBetween(input.requesterUserId, recipient.id)) {
    throw new FriendError(
      ErrorCodes.CONFLICT,
      409,
      'You are already friends with this user.',
      { reason: 'alreadyFriends' },
    );
  }
  const existing = await findOpenFriendRequest(
    input.requesterUserId,
    recipient.id,
  );
  if (existing !== undefined) {
    throw new FriendError(
      ErrorCodes.CONFLICT,
      409,
      'An open friend request already exists.',
      { reason: 'alreadyOpen', requestId: existing.id },
    );
  }
  const trimmed = input.message?.trim();
  const messageToStore = trimmed !== undefined && trimmed.length > 0 ? trimmed : null;
  let row: FriendRequestRow;
  try {
    row = await insertFriendRequest({
      requesterUserId: input.requesterUserId,
      recipientUserId: recipient.id,
      message: messageToStore,
    });
  } catch (err: unknown) {
    // Two concurrent submissions can both clear `findOpenFriendRequest`
    // and then race on the partial unique index
    // `friend_requests_open_uq`. Translate that specific race into the
    // same CONFLICT the pre-check would have produced, rather than a 500.
    // Any other unique violation (a future CHECK constraint tripping,
    // FK constraint name reused, etc.) falls through unchanged so it
    // surfaces as an operator-visible 500 instead of a misleading 409.
    if (
      isUniqueViolation(err) &&
      extractPgConstraint(err) === 'friend_requests_open_uq'
    ) {
      throw new FriendError(
        ErrorCodes.CONFLICT,
        409,
        'An open friend request already exists.',
        { reason: 'alreadyOpen' },
      );
    }
    throw err;
  }
  return { request: row, recipientUsername: recipient.username };
}

export interface AcceptFriendRequestInput {
  requestId: string;
  recipientUserId: string;
}

export interface AcceptFriendRequestResult {
  request: FriendRequestRow;
  friendship: FriendshipRow;
}

export async function acceptOpenFriendRequest(
  input: AcceptFriendRequestInput,
): Promise<AcceptFriendRequestResult> {
  const existing = await findFriendRequestById(input.requestId);
  if (existing === undefined) {
    throw new FriendError(
      ErrorCodes.NOT_FOUND,
      404,
      'Friend request not found.',
    );
  }
  if (existing.recipientUserId !== input.recipientUserId) {
    // Don't leak whether the request exists for another user — same 404.
    throw new FriendError(
      ErrorCodes.NOT_FOUND,
      404,
      'Friend request not found.',
    );
  }
  if (existing.status !== 'open') {
    throw new FriendError(
      ErrorCodes.CONFLICT,
      409,
      'Friend request is no longer open.',
      { status: existing.status },
    );
  }
  // A block landed between the original request and the accept. The
  // invariant in state-model §7.4 says blocks override friendship
  // behavior, so the accept has to be rejected too.
  if (
    await findActiveBlockBetween(existing.requesterUserId, existing.recipientUserId)
  ) {
    throw new FriendError(
      ErrorCodes.DM_NOT_ALLOWED,
      403,
      'A block between these users prevents the friendship from being established.',
    );
  }
  const result = await acceptFriendRequest(input.requestId, input.recipientUserId);
  if (result === undefined) {
    // Another request beat us to it. Re-read the latest status so we
    // can tell the caller whether it's already accepted (effectively
    // the intended end-state — treat as success) or was rejected
    // (CONFLICT).
    const after = await findFriendRequestById(input.requestId);
    if (after?.status === 'accepted') {
      throw new FriendError(
        ErrorCodes.CONFLICT,
        409,
        'Friend request has already been accepted.',
        { status: 'accepted' },
      );
    }
    throw new FriendError(
      ErrorCodes.CONFLICT,
      409,
      'Friend request is no longer open.',
      { status: after?.status ?? 'unknown' },
    );
  }
  return result;
}

export interface RejectFriendRequestInput {
  requestId: string;
  recipientUserId: string;
}

export async function rejectOpenFriendRequest(
  input: RejectFriendRequestInput,
): Promise<FriendRequestRow> {
  const existing = await findFriendRequestById(input.requestId);
  if (existing === undefined || existing.recipientUserId !== input.recipientUserId) {
    throw new FriendError(
      ErrorCodes.NOT_FOUND,
      404,
      'Friend request not found.',
    );
  }
  if (existing.status !== 'open') {
    throw new FriendError(
      ErrorCodes.CONFLICT,
      409,
      'Friend request is no longer open.',
      { status: existing.status },
    );
  }
  const closed = await rejectFriendRequest(input.requestId, input.recipientUserId);
  if (closed === undefined) {
    throw new FriendError(
      ErrorCodes.CONFLICT,
      409,
      'Friend request is no longer open.',
    );
  }
  return closed;
}

export interface RemoveFriendInput {
  callerUserId: string;
  otherUserId: string;
}

// AC-DM-03: either side can end the friendship. The read side (WS-04
// send path) already treats "no active friendship" as DM frozen, so
// no extra chat-state mutation is needed here.
export async function removeFriendship(input: RemoveFriendInput): Promise<void> {
  if (input.callerUserId === input.otherUserId) {
    throw new FriendError(
      ErrorCodes.VALIDATION_ERROR,
      400,
      'Cannot remove yourself.',
      { field: 'userId' },
    );
  }
  const active = await findActiveFriendshipBetween(
    input.callerUserId,
    input.otherUserId,
  );
  if (!active) {
    throw new FriendError(
      ErrorCodes.NOT_FOUND,
      404,
      'Friendship not found.',
    );
  }
  const ok = await endFriendship(input.callerUserId, input.otherUserId);
  if (!ok) {
    // Another call raced us — already removed. Treat as idempotent 200.
    return;
  }
}

import { ErrorCodes } from 'shared-schemas';
import type { FriendRequestRow } from '../../db/schema/friend-requests.js';
import { normalizeUsername } from '../auth/normalize.js';
import { FriendError } from './errors.js';
import {
  findActiveBlockBetween,
  findActiveFriendshipBetween,
  findOpenFriendRequest,
  findUserByUsernameCanonical,
  insertFriendRequest,
  isUniqueViolation,
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
    if (isUniqueViolation(err)) {
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

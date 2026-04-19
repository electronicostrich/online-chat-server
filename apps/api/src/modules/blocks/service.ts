import { ErrorCodes } from 'shared-schemas';
import { BlockError } from './errors.js';
import {
  findUserById,
  insertActiveBlockIgnoreConflict,
} from './repository.js';

export interface BlockUserInput {
  blockerUserId: string;
  blockedUserId: string;
}

// Idempotent by design: if an active block already exists, return
// success. The write path uses ON CONFLICT DO NOTHING so concurrent
// callers never race into a duplicate-active-block 500 or the second
// call tripping the partial unique index.
export async function blockUser(input: BlockUserInput): Promise<void> {
  if (input.blockedUserId === input.blockerUserId) {
    throw new BlockError(
      ErrorCodes.VALIDATION_ERROR,
      400,
      'Cannot block yourself.',
    );
  }
  const target = await findUserById(input.blockedUserId);
  if (target === undefined) {
    throw new BlockError(ErrorCodes.NOT_FOUND, 404, 'User not found.');
  }
  await insertActiveBlockIgnoreConflict(
    input.blockerUserId,
    input.blockedUserId,
  );
}

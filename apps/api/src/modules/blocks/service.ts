import { ErrorCodes } from 'shared-schemas';
import { BlockError } from './errors.js';
import {
  findActiveBlock,
  findUserById,
  insertActiveBlock,
} from './repository.js';

export interface BlockUserInput {
  blockerUserId: string;
  blockedUserId: string;
}

// Idempotent: if an active block already exists, just return it rather
// than 409. The UI treats "block" as a state toggle, and the side-effect
// (DM freeze) is unchanged whether this is the first or Nth call.
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
  const existing = await findActiveBlock(
    input.blockerUserId,
    input.blockedUserId,
  );
  if (existing !== undefined) return;
  await insertActiveBlock(input.blockerUserId, input.blockedUserId);
}

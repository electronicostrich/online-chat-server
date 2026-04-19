import { ErrorCodes } from 'shared-schemas';
import type { RoomRow } from '../../db/schema/rooms.js';
import { RoomError } from './errors.js';
import { normalizeRoomName } from './normalize.js';
import {
  extractPgConstraint,
  findRoomByChatId,
  insertRoomWithOwner,
  isUniqueViolation,
  softDeleteRoom,
} from './repository.js';

export interface CreateRoomInput {
  ownerUserId: string;
  name: string;
  description?: string;
  visibility: 'public' | 'private';
}

export async function createRoom(input: CreateRoomInput): Promise<RoomRow> {
  const trimmedName = input.name.trim();
  const normalizedName = normalizeRoomName(input.name);
  if (normalizedName.length === 0) {
    throw new RoomError(
      ErrorCodes.VALIDATION_ERROR,
      400,
      'Room name cannot be empty after normalization.',
      { field: 'name' },
    );
  }
  try {
    const inserted = await insertRoomWithOwner({
      name: trimmedName,
      normalizedName,
      description: input.description?.trim() ?? null,
      visibility: input.visibility,
      ownerUserId: input.ownerUserId,
    });
    return inserted.room;
  } catch (err: unknown) {
    if (isUniqueViolation(err)) {
      const constraint = extractPgConstraint(err) ?? '';
      if (/normalized_name|rooms_normalized_name/u.test(constraint)) {
        throw new RoomError(
          ErrorCodes.CONFLICT,
          409,
          'A room with this name already exists.',
          { field: 'name' },
        );
      }
    }
    throw err;
  }
}

export async function deleteRoom(input: {
  callerUserId: string;
  chatId: string;
}): Promise<void> {
  const room = await findRoomByChatId(input.chatId);
  if (room === undefined) {
    throw new RoomError(ErrorCodes.NOT_FOUND, 404, 'Room not found.');
  }
  if (room.ownerUserId !== input.callerUserId) {
    throw new RoomError(
      ErrorCodes.FORBIDDEN,
      403,
      'Only the room owner may delete this room.',
    );
  }
  const ok = await softDeleteRoom(input.chatId);
  if (!ok) {
    // Lost race: another request deleted the room between the lookup
    // and the update. Report the same 404 a cold caller would see.
    throw new RoomError(ErrorCodes.NOT_FOUND, 404, 'Room not found.');
  }
}

export function toPublicRoom(row: RoomRow): {
  chatId: string;
  name: string;
  description: string | null;
  visibility: 'public' | 'private';
  ownerUserId: string;
  createdAt: string;
} {
  return {
    chatId: row.chatId,
    name: row.name,
    description: row.description ?? null,
    visibility: row.visibility,
    ownerUserId: row.ownerUserId,
    createdAt: row.createdAt.toISOString(),
  };
}

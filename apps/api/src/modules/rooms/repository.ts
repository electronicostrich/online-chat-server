import { and, eq, isNull } from 'drizzle-orm';
import { db, pgSql } from '../../db/client.js';
import { chats, type ChatRow } from '../../db/schema/chats.js';
import { rooms, type RoomRow } from '../../db/schema/rooms.js';
import {
  roomMemberships,
  type RoomMembershipRow,
} from '../../db/schema/room-memberships.js';

export interface InsertRoomParams {
  name: string;
  normalizedName: string;
  description: string | null;
  visibility: 'public' | 'private';
  ownerUserId: string;
}

export interface InsertedRoom {
  chat: ChatRow;
  room: RoomRow;
  ownerMembership: RoomMembershipRow;
}

// Creates the chat + room + owner-membership in a single transaction so
// a partial failure never leaves an orphan chat without a room record.
export async function insertRoomWithOwner(
  params: InsertRoomParams,
): Promise<InsertedRoom> {
  return db.transaction(async (tx) => {
    const [chatRow] = await tx
      .insert(chats)
      .values({ type: 'room' })
      .returning();
    if (chatRow === undefined) {
      throw new Error('insertRoomWithOwner: chat insert returned no row');
    }
    const [roomRow] = await tx
      .insert(rooms)
      .values({
        chatId: chatRow.id,
        name: params.name,
        normalizedName: params.normalizedName,
        description: params.description,
        visibility: params.visibility,
        ownerUserId: params.ownerUserId,
      })
      .returning();
    if (roomRow === undefined) {
      throw new Error('insertRoomWithOwner: room insert returned no row');
    }
    const [membershipRow] = await tx
      .insert(roomMemberships)
      .values({
        roomChatId: roomRow.chatId,
        userId: params.ownerUserId,
        role: 'owner',
      })
      .returning();
    if (membershipRow === undefined) {
      throw new Error('insertRoomWithOwner: membership insert returned no row');
    }
    return { chat: chatRow, room: roomRow, ownerMembership: membershipRow };
  });
}

export async function findRoomByChatId(
  chatId: string,
): Promise<RoomRow | undefined> {
  const rows = await db
    .select()
    .from(rooms)
    .where(and(eq(rooms.chatId, chatId), isNull(rooms.deletedAt)))
    .limit(1);
  return rows[0];
}

// Soft-deletes the room + underlying chat in a single transaction so a
// failure on the second update never leaves the DB in the "room
// tombstoned but chat still active" state. Returns true if the room was
// soft-deleted, false if it was already deleted or missing. The
// cascade on room_memberships / room_bans / room_invitations is handled
// at the FK layer when the chat is hard-deleted by the nightly purge
// job; for soft-delete we only toggle the timestamp columns.
export async function softDeleteRoom(chatId: string): Promise<boolean> {
  return db.transaction(async (tx) => {
    const now = new Date();
    const updated = await tx
      .update(rooms)
      .set({ deletedAt: now, updatedAt: now })
      .where(and(eq(rooms.chatId, chatId), isNull(rooms.deletedAt)))
      .returning({ chatId: rooms.chatId });
    if (updated.length === 0) return false;
    await tx
      .update(chats)
      .set({ deletedAt: now })
      .where(and(eq(chats.id, chatId), isNull(chats.deletedAt)));
    return true;
  });
}

// Exported only so tests that need raw SQL access can share the same
// client. Production code should use the Drizzle-typed helpers above.
export { pgSql };
// Re-exported so callers of this module don't need to reach past it into
// `../../shared/pg-errors.js` — keeps the module-local API cohesive
// while the shared helper is the single point of truth.
export {
  extractPgConstraint,
  isUniqueViolation,
} from '../../shared/pg-errors.js';

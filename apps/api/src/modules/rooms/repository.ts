import { and, desc, eq, ilike, isNull, lt, or, sql } from 'drizzle-orm';
import { db, pgSql } from '../../db/client.js';
import { chats, type ChatRow } from '../../db/schema/chats.js';
import { rooms, type RoomRow } from '../../db/schema/rooms.js';
import {
  roomMemberships,
  type RoomMembershipRow,
} from '../../db/schema/room-memberships.js';
import { roomBans, type RoomBanRow } from '../../db/schema/room-bans.js';
import {
  roomInvitations,
  type RoomInvitationRow,
} from '../../db/schema/room-invitations.js';
import { users, type UserRow } from '../../db/schema/users.js';

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
// tombstoned but chat still active" state. Returns `{ok: true, ...}`
// when the room was soft-deleted, `{ok: false, members: []}` when it
// was already deleted or missing. The cascade on room_memberships /
// room_bans / room_invitations is handled at the FK layer when the
// chat is hard-deleted by the nightly purge job; for soft-delete we
// only toggle the timestamp columns.
//
// The active-member snapshot is returned so the service layer can fan
// out `room.membership.updated: left` to each member's live sockets
// after the transaction commits. Loading it inside the transaction
// guarantees a concurrent join does not slip into the room between
// the snapshot and the delete (the snapshot sees the same committed
// state as the row update).
export interface SoftDeleteRoomResult {
  ok: boolean;
  members: Array<{ userId: string; role: 'owner' | 'admin' | 'member' }>;
}

export async function softDeleteRoom(
  chatId: string,
): Promise<SoftDeleteRoomResult> {
  return db.transaction(async (tx) => {
    const now = new Date();
    const updated = await tx
      .update(rooms)
      .set({ deletedAt: now, updatedAt: now })
      .where(and(eq(rooms.chatId, chatId), isNull(rooms.deletedAt)))
      .returning({ chatId: rooms.chatId });
    if (updated.length === 0) return { ok: false, members: [] };
    const members = await tx
      .select({
        userId: roomMemberships.userId,
        role: roomMemberships.role,
      })
      .from(roomMemberships)
      .where(
        and(
          eq(roomMemberships.roomChatId, chatId),
          isNull(roomMemberships.leftAt),
        ),
      );
    await tx
      .update(chats)
      .set({ deletedAt: now })
      .where(and(eq(chats.id, chatId), isNull(chats.deletedAt)));
    return { ok: true, members };
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

export interface PublicRoomCatalogRow {
  chatId: string;
  name: string;
  description: string | null;
  memberCount: number;
  createdAt: Date;
}

export interface ListPublicRoomsParams {
  search?: string;
  limit: number;
  cursor?: { createdAt: Date; chatId: string };
}

// Lists active public rooms ordered by createdAt DESC (then chatId DESC
// as tiebreaker) so the keyset cursor is strictly monotonic. Private
// rooms are excluded at the SQL layer — AC-ROOM-04 only the catalog
// path should exclude them; direct fetches by id stay allowed for
// members.
export async function listPublicRooms(
  params: ListPublicRoomsParams,
): Promise<PublicRoomCatalogRow[]> {
  const conditions = [
    eq(rooms.visibility, 'public'),
    isNull(rooms.deletedAt),
  ];
  if (params.search !== undefined && params.search.trim().length > 0) {
    // Case-insensitive substring match against the original name so users
    // can find "Engineering" by typing "engi". Uses ILIKE with the
    // Postgres-standard %escape% wrapping; the normalized_name column
    // isn't used here because the search is free-text, not canonicalized.
    const escaped = params.search
      .trim()
      .replace(/\\/gu, '\\\\')
      .replace(/%/gu, '\\%')
      .replace(/_/gu, '\\_');
    conditions.push(ilike(rooms.name, `%${escaped}%`));
  }
  if (params.cursor !== undefined) {
    // Keyset paging: rows strictly less than the cursor. Tiebreaker on
    // chatId DESC means a subsequent insert at the same instant keeps the
    // page boundary stable.
    const cursorPredicate = or(
      lt(rooms.createdAt, params.cursor.createdAt),
      and(
        eq(rooms.createdAt, params.cursor.createdAt),
        lt(rooms.chatId, params.cursor.chatId),
      ),
    );
    if (cursorPredicate !== undefined) conditions.push(cursorPredicate);
  }
  const rowsResult = await db
    .select({
      chatId: rooms.chatId,
      name: rooms.name,
      description: rooms.description,
      createdAt: rooms.createdAt,
      memberCount: sql<number>`(
        SELECT COUNT(*)::int FROM ${roomMemberships}
        WHERE ${roomMemberships.roomChatId} = ${rooms.chatId}
          AND ${roomMemberships.leftAt} IS NULL
      )`,
    })
    .from(rooms)
    .where(and(...conditions))
    .orderBy(desc(rooms.createdAt), desc(rooms.chatId))
    .limit(params.limit);
  return rowsResult.map((r) => ({
    chatId: r.chatId,
    name: r.name,
    description: r.description ?? null,
    memberCount: r.memberCount,
    createdAt: r.createdAt,
  }));
}

export async function findActiveMembership(
  chatId: string,
  userId: string,
): Promise<RoomMembershipRow | undefined> {
  const rows = await db
    .select()
    .from(roomMemberships)
    .where(
      and(
        eq(roomMemberships.roomChatId, chatId),
        eq(roomMemberships.userId, userId),
        isNull(roomMemberships.leftAt),
      ),
    )
    .limit(1);
  return rows[0];
}

export async function findActiveBan(
  chatId: string,
  userId: string,
): Promise<RoomBanRow | undefined> {
  const rows = await db
    .select()
    .from(roomBans)
    .where(
      and(
        eq(roomBans.roomChatId, chatId),
        eq(roomBans.userId, userId),
        isNull(roomBans.removedAt),
      ),
    )
    .limit(1);
  return rows[0];
}

// Joins a user as a `member`. Returns the inserted/restored row, or
// `undefined` if the insert raced with another concurrent join.
// Single-transaction so the active-ban re-check and the insert commit
// or fail together — a ban landing between the service preflight and
// the insert must reject the join.
export async function joinRoomAsMember(
  chatId: string,
  userId: string,
): Promise<{ role: 'member'; membership: RoomMembershipRow } | undefined> {
  return db.transaction(async (tx) => {
    // Re-check that the room is still active and the caller still has
    // no active ban, atomically with the insert.
    const roomRows = await tx
      .select({ chatId: rooms.chatId })
      .from(rooms)
      .where(and(eq(rooms.chatId, chatId), isNull(rooms.deletedAt)))
      .limit(1);
    if (roomRows[0] === undefined) return undefined;
    const banRows = await tx
      .select({ id: roomBans.id })
      .from(roomBans)
      .where(
        and(
          eq(roomBans.roomChatId, chatId),
          eq(roomBans.userId, userId),
          isNull(roomBans.removedAt),
        ),
      )
      .limit(1);
    if (banRows[0] !== undefined) return undefined;
    const [row] = await tx
      .insert(roomMemberships)
      .values({ roomChatId: chatId, userId, role: 'member' })
      .returning();
    if (row === undefined) return undefined;
    return { role: 'member', membership: row };
  });
}

// Marks the caller's active membership as left. Idempotent shape:
// returns true if a row was updated, false if no active row existed.
export async function leaveRoom(
  chatId: string,
  userId: string,
): Promise<boolean> {
  const updated = await db
    .update(roomMemberships)
    .set({ leftAt: sql`NOW()` })
    .where(
      and(
        eq(roomMemberships.roomChatId, chatId),
        eq(roomMemberships.userId, userId),
        isNull(roomMemberships.leftAt),
      ),
    )
    .returning({ id: roomMemberships.id });
  return updated.length > 0;
}

export interface RemoveMemberResult {
  membership: RoomMembershipRow;
  ban: RoomBanRow;
}

// Remove-is-ban: transitions the active membership to `left` AND opens
// a room_ban row (if not already open) in the same transaction so the
// user cannot re-join through `joinRoomAsMember`. Caller must be an
// admin or owner; policy is enforced in the service. `targetUserId`
// cannot be the room owner (AC-MOD-01 / AC-MOD-07 invariant — policy
// caller checks this too).
export async function removeMemberAsBan(params: {
  chatId: string;
  targetUserId: string;
  actorUserId: string;
}): Promise<RemoveMemberResult | undefined> {
  return db.transaction(async (tx) => {
    const [membership] = await tx
      .update(roomMemberships)
      .set({
        leftAt: sql`NOW()`,
        removedByUserId: params.actorUserId,
      })
      .where(
        and(
          eq(roomMemberships.roomChatId, params.chatId),
          eq(roomMemberships.userId, params.targetUserId),
          isNull(roomMemberships.leftAt),
        ),
      )
      .returning();
    if (membership === undefined) return undefined;
    // ON CONFLICT DO NOTHING against the partial unique index so a
    // rapid re-ban doesn't trip a 500; we fetch the active row in
    // either case.
    await tx.execute(sql`
      INSERT INTO ${roomBans} (room_chat_id, user_id, banned_by_user_id)
      VALUES (${params.chatId}, ${params.targetUserId}, ${params.actorUserId})
      ON CONFLICT (room_chat_id, user_id)
        WHERE removed_at IS NULL
        DO NOTHING
    `);
    const [ban] = await tx
      .select()
      .from(roomBans)
      .where(
        and(
          eq(roomBans.roomChatId, params.chatId),
          eq(roomBans.userId, params.targetUserId),
          isNull(roomBans.removedAt),
        ),
      )
      .limit(1);
    if (ban === undefined) {
      throw new Error('removeMemberAsBan: ban row not found after insert');
    }
    return { membership, ban };
  });
}

export async function listActiveBansWithActors(
  chatId: string,
): Promise<
  Array<{
    userId: string;
    username: string;
    bannedByUserId: string | null;
    bannedByUsername: string | null;
    createdAt: Date;
  }>
> {
  // Self-join users twice: once for the banned user, once for the actor
  // (which may be null if the actor account has been hard-deleted).
  const rowsResult = await db.execute<{
    user_id: string;
    username: string;
    banned_by_user_id: string | null;
    banned_by_username: string | null;
    created_at: Date;
  }>(sql`
    SELECT
      b.user_id AS user_id,
      bu.username AS username,
      b.banned_by_user_id AS banned_by_user_id,
      au.username AS banned_by_username,
      b.created_at AS created_at
    FROM ${roomBans} b
    JOIN ${users} bu ON bu.id = b.user_id
    LEFT JOIN ${users} au ON au.id = b.banned_by_user_id
    WHERE b.room_chat_id = ${chatId}
      AND b.removed_at IS NULL
    ORDER BY b.created_at DESC, b.id DESC
  `);
  return rowsResult.map((r) => ({
    userId: r.user_id,
    username: r.username,
    bannedByUserId: r.banned_by_user_id,
    bannedByUsername: r.banned_by_username,
    createdAt: new Date(r.created_at),
  }));
}

// Idempotent unban: set removed_at on the active ban row. Returns true
// if a row was updated.
export async function unbanUser(
  chatId: string,
  userId: string,
): Promise<boolean> {
  const updated = await db
    .update(roomBans)
    .set({ removedAt: sql`NOW()` })
    .where(
      and(
        eq(roomBans.roomChatId, chatId),
        eq(roomBans.userId, userId),
        isNull(roomBans.removedAt),
      ),
    )
    .returning({ id: roomBans.id });
  return updated.length > 0;
}

// Role transitions. Update only the role column; do not touch joined_at
// (the user is already a member). Returns the updated membership row or
// undefined if the target is not a current member.
export async function updateMembershipRole(params: {
  chatId: string;
  userId: string;
  newRole: 'admin' | 'member';
}): Promise<RoomMembershipRow | undefined> {
  const [updated] = await db
    .update(roomMemberships)
    .set({ role: params.newRole })
    .where(
      and(
        eq(roomMemberships.roomChatId, params.chatId),
        eq(roomMemberships.userId, params.userId),
        isNull(roomMemberships.leftAt),
      ),
    )
    .returning();
  return updated;
}

// Looks up an active (status='active') user by exact username match. The
// friends repository has its own copy keyed on the canonical lowercase
// form; invites take the raw `username` column for a registered-user
// check that does not depend on canonicalization rules.
export async function findActiveUserByUsername(
  username: string,
): Promise<UserRow | undefined> {
  const rows = await db
    .select()
    .from(users)
    .where(and(eq(users.username, username), eq(users.status, 'active')))
    .limit(1);
  return rows[0];
}

export async function findOpenInvitation(
  roomChatId: string,
  inviteeUserId: string,
): Promise<RoomInvitationRow | undefined> {
  const rows = await db
    .select()
    .from(roomInvitations)
    .where(
      and(
        eq(roomInvitations.roomChatId, roomChatId),
        eq(roomInvitations.inviteeUserId, inviteeUserId),
        eq(roomInvitations.status, 'open'),
      ),
    )
    .limit(1);
  return rows[0];
}

export async function insertRoomInvitation(params: {
  roomChatId: string;
  inviterUserId: string;
  inviteeUserId: string;
}): Promise<RoomInvitationRow> {
  const [row] = await db
    .insert(roomInvitations)
    .values({
      roomChatId: params.roomChatId,
      inviterUserId: params.inviterUserId,
      inviteeUserId: params.inviteeUserId,
      status: 'open',
    })
    .returning();
  if (row === undefined) {
    throw new Error('insertRoomInvitation returned no row');
  }
  return row;
}

export async function findRoomInvitationById(
  id: string,
): Promise<RoomInvitationRow | undefined> {
  const rows = await db
    .select()
    .from(roomInvitations)
    .where(eq(roomInvitations.id, id))
    .limit(1);
  return rows[0];
}

// Accept-invite transaction: re-checks room-alive, no-active-ban, and
// invitation-still-open under the same row-locking transaction as the
// membership insert so a ban or concurrent accept lands in exactly one
// branch. Returns `undefined` if the invitation is no longer open (race),
// `{ bannedAt: true }` if the invitee became banned before commit, or
// `{ membership, invitation }` on success.
export type AcceptInvitationOutcome =
  | { kind: 'accepted'; invitation: RoomInvitationRow; membership: RoomMembershipRow }
  | { kind: 'banned' }
  | { kind: 'notOpen' }
  | { kind: 'roomGone' };

export async function acceptRoomInvitation(params: {
  invitationId: string;
  inviteeUserId: string;
}): Promise<AcceptInvitationOutcome> {
  return db.transaction(async (tx) => {
    // Load the invitation under transactional snapshot so nothing else
    // can close it between the checks and the update.
    const [invitation] = await tx
      .select()
      .from(roomInvitations)
      .where(eq(roomInvitations.id, params.invitationId))
      .limit(1);
    if (invitation === undefined) return { kind: 'notOpen' };
    if (invitation.inviteeUserId !== params.inviteeUserId) {
      // Callers that aren't the invitee see 404 in the service layer;
      // repository returns notOpen so the service can normalize it.
      return { kind: 'notOpen' };
    }
    if (invitation.status !== 'open') return { kind: 'notOpen' };
    // Room must still be active — soft-deleted room can't gain members.
    const [roomRow] = await tx
      .select({ chatId: rooms.chatId })
      .from(rooms)
      .where(
        and(eq(rooms.chatId, invitation.roomChatId), isNull(rooms.deletedAt)),
      )
      .limit(1);
    if (roomRow === undefined) return { kind: 'roomGone' };
    // Ban re-check (AC-INV-04): invite can't consume past an active ban.
    const [banRow] = await tx
      .select({ id: roomBans.id })
      .from(roomBans)
      .where(
        and(
          eq(roomBans.roomChatId, invitation.roomChatId),
          eq(roomBans.userId, params.inviteeUserId),
          isNull(roomBans.removedAt),
        ),
      )
      .limit(1);
    if (banRow !== undefined) return { kind: 'banned' };
    // Close the invitation atomically with the membership insert. Use a
    // conditional UPDATE so a concurrent accept/reject loses the race.
    const [closed] = await tx
      .update(roomInvitations)
      .set({ status: 'accepted', respondedAt: sql`NOW()` })
      .where(
        and(
          eq(roomInvitations.id, params.invitationId),
          eq(roomInvitations.status, 'open'),
        ),
      )
      .returning();
    if (closed === undefined) return { kind: 'notOpen' };
    // If the invitee already has an active membership (e.g. they joined
    // via a different invite and then this one was accepted second), keep
    // that row. Otherwise insert a fresh 'member' row.
    const [existingMembership] = await tx
      .select()
      .from(roomMemberships)
      .where(
        and(
          eq(roomMemberships.roomChatId, invitation.roomChatId),
          eq(roomMemberships.userId, params.inviteeUserId),
          isNull(roomMemberships.leftAt),
        ),
      )
      .limit(1);
    if (existingMembership !== undefined) {
      return {
        kind: 'accepted',
        invitation: closed,
        membership: existingMembership,
      };
    }
    const [membership] = await tx
      .insert(roomMemberships)
      .values({
        roomChatId: invitation.roomChatId,
        userId: params.inviteeUserId,
        role: 'member',
      })
      .returning();
    if (membership === undefined) {
      throw new Error('acceptRoomInvitation: membership insert returned no row');
    }
    return { kind: 'accepted', invitation: closed, membership };
  });
}

// Reject an open invite. Returns the closed row, or undefined if the
// invitation was no longer open (already accepted / rejected / revoked).
export async function rejectRoomInvitation(params: {
  invitationId: string;
  inviteeUserId: string;
}): Promise<RoomInvitationRow | undefined> {
  const [closed] = await db
    .update(roomInvitations)
    .set({ status: 'rejected', respondedAt: sql`NOW()` })
    .where(
      and(
        eq(roomInvitations.id, params.invitationId),
        eq(roomInvitations.inviteeUserId, params.inviteeUserId),
        eq(roomInvitations.status, 'open'),
      ),
    )
    .returning();
  return closed;
}

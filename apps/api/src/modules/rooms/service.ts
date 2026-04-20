import {
  ErrorCodes,
  PAGINATION_CURSOR_DEFAULT_LIMIT,
  PAGINATION_CURSOR_MAX_LIMIT,
} from 'shared-schemas';
import type { RoomRow } from '../../db/schema/rooms.js';
import {
  publishRoomBanUpdated,
  publishRoomInvitationCreated,
  publishRoomMembershipUpdated,
} from '../realtime/index.js';
import { RoomError } from './errors.js';
import { normalizeRoomName } from './normalize.js';
import {
  acceptRoomInvitation,
  extractPgConstraint,
  findActiveBan,
  findActiveMembership,
  findActiveUserByUsername,
  findOpenInvitation,
  findRoomByChatId,
  findRoomInvitationById,
  insertRoomInvitation,
  insertRoomWithOwner,
  isUniqueViolation,
  joinRoomAsMember,
  leaveRoom,
  listActiveBansWithActors,
  listPublicRooms,
  rejectRoomInvitation,
  removeMemberAsBan,
  softDeleteRoom,
  unbanUser,
  updateMembershipRole,
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
  const result = await softDeleteRoom(input.chatId);
  if (!result.ok) {
    // Lost race: another request deleted the room between the lookup
    // and the update. Report the same 404 a cold caller would see.
    throw new RoomError(ErrorCodes.NOT_FOUND, 404, 'Room not found.');
  }
  // Fan out `room.membership.updated: left` to every member that was
  // active at delete time. The chat is now soft-deleted so no *new*
  // `chat.subscribe` command would succeed for this room, but
  // `fanOutRoomEventIncludingSubject` still delivers to every socket
  // whose `subscriptions` set already contains `chatId` — the
  // subscription set is not purged on delete. That's how the
  // already-subscribed owner socket receives one event per member.
  // Non-subscribing tabs (catalog / sidebar) receive their single
  // self-event via the subject path so they can drop the room from
  // their UI without waiting for the next reconnect.
  for (const member of result.members) {
    publishRoomMembershipUpdated({
      chatId: input.chatId,
      userId: member.userId,
      membershipState: 'left',
      role: member.role,
    });
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

export interface PublicRoomCatalogItem {
  chatId: string;
  name: string;
  description: string | null;
  memberCount: number;
  createdAt: string;
}

interface DecodedCursor {
  createdAt: Date;
  chatId: string;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;

function decodeCatalogCursor(raw: string): DecodedCursor {
  let decoded: string;
  try {
    // base64url → utf-8. Node's atob tolerates only base64 with +/;
    // we feed it a translated form.
    const padded = raw.replace(/-/gu, '+').replace(/_/gu, '/');
    decoded = Buffer.from(padded, 'base64').toString('utf8');
  } catch {
    throw new RoomError(ErrorCodes.VALIDATION_ERROR, 400, 'Invalid cursor.', {
      field: 'cursor',
    });
  }
  const sepIdx = decoded.indexOf('|');
  if (sepIdx <= 0 || sepIdx === decoded.length - 1) {
    throw new RoomError(ErrorCodes.VALIDATION_ERROR, 400, 'Invalid cursor.', {
      field: 'cursor',
    });
  }
  const createdAtRaw = decoded.slice(0, sepIdx);
  const chatId = decoded.slice(sepIdx + 1);
  const createdAt = new Date(createdAtRaw);
  if (Number.isNaN(createdAt.getTime()) || !UUID_RE.test(chatId)) {
    throw new RoomError(ErrorCodes.VALIDATION_ERROR, 400, 'Invalid cursor.', {
      field: 'cursor',
    });
  }
  return { createdAt, chatId };
}

function encodeCatalogCursor(createdAt: Date, chatId: string): string {
  const raw = `${createdAt.toISOString()}|${chatId}`;
  return Buffer.from(raw, 'utf8')
    .toString('base64')
    .replace(/\+/gu, '-')
    .replace(/\//gu, '_')
    .replace(/=+$/u, '');
}

export async function fetchPublicRoomsPage(input: {
  search?: string | undefined;
  cursor?: string | undefined;
  limit?: number | undefined;
}): Promise<{ rooms: PublicRoomCatalogItem[]; nextCursor: string | null }> {
  const limit = Math.min(
    input.limit ?? PAGINATION_CURSOR_DEFAULT_LIMIT,
    PAGINATION_CURSOR_MAX_LIMIT,
  );
  const listArgs: Parameters<typeof listPublicRooms>[0] = { limit };
  if (input.search !== undefined) listArgs.search = input.search;
  if (input.cursor !== undefined) {
    listArgs.cursor = decodeCatalogCursor(input.cursor);
  }
  const rows = await listPublicRooms(listArgs);
  // If we got a full page, assume there may be more: emit a cursor for
  // the last row. A page short of `limit` is the end.
  const last = rows[rows.length - 1];
  const nextCursor =
    rows.length === limit && last !== undefined
      ? encodeCatalogCursor(last.createdAt, last.chatId)
      : null;
  return {
    rooms: rows.map((r) => ({
      chatId: r.chatId,
      name: r.name,
      description: r.description,
      memberCount: r.memberCount,
      createdAt: r.createdAt.toISOString(),
    })),
    nextCursor,
  };
}

export async function joinPublicRoom(input: {
  chatId: string;
  userId: string;
}): Promise<{ role: 'owner' | 'admin' | 'member' }> {
  const room = await findRoomByChatId(input.chatId);
  if (room === undefined) {
    throw new RoomError(ErrorCodes.NOT_FOUND, 404, 'Room not found.');
  }
  if (room.visibility !== 'public') {
    // Private rooms are only joinable via accepted invitation; the
    // public join endpoint treats them as invisible for symmetry with
    // AC-ROOM-04 (catalog hiding).
    throw new RoomError(ErrorCodes.NOT_FOUND, 404, 'Room not found.');
  }
  // Re-entry path: the user might have left previously, or was banned
  // and then unbanned. If they have an active membership already, the
  // join is a no-op (idempotent) reporting the current role.
  const existing = await findActiveMembership(input.chatId, input.userId);
  if (existing !== undefined) {
    return { role: existing.role };
  }
  if ((await findActiveBan(input.chatId, input.userId)) !== undefined) {
    throw new RoomError(
      ErrorCodes.ROOM_BANNED,
      403,
      'You are banned from this room.',
    );
  }
  const result = await joinRoomAsMember(input.chatId, input.userId);
  if (result === undefined) {
    // A ban or room-delete landed between the preflight and the insert,
    // or a concurrent join ran. Re-check to pick the right error.
    const ban = await findActiveBan(input.chatId, input.userId);
    if (ban !== undefined) {
      throw new RoomError(
        ErrorCodes.ROOM_BANNED,
        403,
        'You are banned from this room.',
      );
    }
    const existingAfter = await findActiveMembership(input.chatId, input.userId);
    if (existingAfter !== undefined) {
      return { role: existingAfter.role };
    }
    throw new RoomError(ErrorCodes.NOT_FOUND, 404, 'Room not found.');
  }
  publishRoomMembershipUpdated({
    chatId: input.chatId,
    userId: input.userId,
    membershipState: 'member',
    role: result.role,
  });
  return { role: result.role };
}

export async function leaveRoomAsMember(input: {
  chatId: string;
  userId: string;
}): Promise<void> {
  const room = await findRoomByChatId(input.chatId);
  if (room === undefined) {
    throw new RoomError(ErrorCodes.NOT_FOUND, 404, 'Room not found.');
  }
  // AC-ROOM-07: owner cannot leave — delete is the only exit path.
  if (room.ownerUserId === input.userId) {
    throw new RoomError(
      ErrorCodes.FORBIDDEN,
      403,
      'The room owner cannot leave the room. Delete the room instead.',
    );
  }
  const membership = await findActiveMembership(input.chatId, input.userId);
  if (membership === undefined) {
    throw new RoomError(
      ErrorCodes.NOT_A_MEMBER,
      403,
      'You are not a member of this room.',
    );
  }
  await leaveRoom(input.chatId, input.userId);
  publishRoomMembershipUpdated({
    chatId: input.chatId,
    userId: input.userId,
    membershipState: 'left',
    role: membership.role,
  });
}

function assertActorHasModeratorRights(
  actorRole: 'owner' | 'admin' | 'member',
): void {
  if (actorRole !== 'owner' && actorRole !== 'admin') {
    throw new RoomError(
      ErrorCodes.FORBIDDEN,
      403,
      'Only a room admin or the owner may perform this action.',
    );
  }
}

async function requireActiveRoom(chatId: string): Promise<RoomRow> {
  const room = await findRoomByChatId(chatId);
  if (room === undefined) {
    throw new RoomError(ErrorCodes.NOT_FOUND, 404, 'Room not found.');
  }
  return room;
}

async function requireActorMembership(
  chatId: string,
  actorUserId: string,
): Promise<'owner' | 'admin' | 'member'> {
  const m = await findActiveMembership(chatId, actorUserId);
  if (m === undefined) {
    throw new RoomError(
      ErrorCodes.NOT_A_MEMBER,
      403,
      'You are not a member of this room.',
    );
  }
  return m.role;
}

export async function removeMember(input: {
  chatId: string;
  actorUserId: string;
  targetUserId: string;
}): Promise<void> {
  const room = await requireActiveRoom(input.chatId);
  const actorRole = await requireActorMembership(
    input.chatId,
    input.actorUserId,
  );
  assertActorHasModeratorRights(actorRole);
  if (input.targetUserId === room.ownerUserId) {
    // AC-MOD-07 invariant: owner can never be removed/banned — delete
    // the room instead.
    throw new RoomError(
      ErrorCodes.FORBIDDEN,
      403,
      'The room owner cannot be removed.',
    );
  }
  if (input.targetUserId === input.actorUserId) {
    throw new RoomError(
      ErrorCodes.VALIDATION_ERROR,
      400,
      'Use leave to remove yourself; the remove action is for other members.',
      { field: 'userId' },
    );
  }
  const targetMembership = await findActiveMembership(
    input.chatId,
    input.targetUserId,
  );
  if (targetMembership === undefined) {
    throw new RoomError(
      ErrorCodes.NOT_A_MEMBER,
      403,
      'Target user is not a current member of this room.',
    );
  }
  // AC-MOD-05/06: an admin can remove another admin (unless that admin
  // is the owner — already excluded above). Owner can remove anyone.
  // Note: the spec does not permit a member to remove another member,
  // which is already covered by `assertActorHasModeratorRights`.
  const result = await removeMemberAsBan({
    chatId: input.chatId,
    targetUserId: input.targetUserId,
    actorUserId: input.actorUserId,
  });
  if (result === undefined) {
    // Membership flipped to left between the preflight and the update.
    // 404/not-a-member either way; pick the latter to stay consistent.
    throw new RoomError(
      ErrorCodes.NOT_A_MEMBER,
      403,
      'Target user is not a current member of this room.',
    );
  }
  // AC-MOD-02 traceability: remove-as-ban emits both events. Membership
  // first so UIs see the member leave before the ban flag; the order is
  // not load-bearing for correctness but matches the natural narrative.
  publishRoomMembershipUpdated({
    chatId: input.chatId,
    userId: input.targetUserId,
    membershipState: 'left',
    role: targetMembership.role,
  });
  publishRoomBanUpdated({
    chatId: input.chatId,
    userId: input.targetUserId,
    isBanned: true,
  });
}

export async function listRoomBans(input: {
  chatId: string;
  actorUserId: string;
}): Promise<
  Array<{
    userId: string;
    username: string;
    bannedByUserId: string | null;
    bannedByUsername: string | null;
    createdAt: string;
  }>
> {
  await requireActiveRoom(input.chatId);
  const actorRole = await requireActorMembership(
    input.chatId,
    input.actorUserId,
  );
  assertActorHasModeratorRights(actorRole);
  const rows = await listActiveBansWithActors(input.chatId);
  return rows.map((r) => ({
    userId: r.userId,
    username: r.username,
    bannedByUserId: r.bannedByUserId,
    bannedByUsername: r.bannedByUsername,
    createdAt: r.createdAt.toISOString(),
  }));
}

export async function unbanRoomUser(input: {
  chatId: string;
  actorUserId: string;
  targetUserId: string;
}): Promise<void> {
  await requireActiveRoom(input.chatId);
  const actorRole = await requireActorMembership(
    input.chatId,
    input.actorUserId,
  );
  assertActorHasModeratorRights(actorRole);
  const ok = await unbanUser(input.chatId, input.targetUserId);
  if (!ok) {
    // The target had no active ban. Report 404 so callers can't probe
    // ban state of arbitrary users via DELETE.
    throw new RoomError(ErrorCodes.NOT_FOUND, 404, 'Ban not found.');
  }
  publishRoomBanUpdated({
    chatId: input.chatId,
    userId: input.targetUserId,
    isBanned: false,
  });
}

export async function makeMemberAdmin(input: {
  chatId: string;
  actorUserId: string;
  targetUserId: string;
}): Promise<{ role: 'owner' | 'admin' | 'member' }> {
  const room = await requireActiveRoom(input.chatId);
  const actorRole = await requireActorMembership(
    input.chatId,
    input.actorUserId,
  );
  assertActorHasModeratorRights(actorRole);
  if (input.targetUserId === room.ownerUserId) {
    // Owner is already admin-equivalent (AC-MOD-01). Promotion is a
    // no-op but VALIDATION_ERROR is closer to the spec ("owner role is
    // not assignable via promotion").
    throw new RoomError(
      ErrorCodes.VALIDATION_ERROR,
      400,
      'Owner is always admin; promotion is not applicable.',
      { field: 'userId' },
    );
  }
  const target = await findActiveMembership(input.chatId, input.targetUserId);
  if (target === undefined) {
    throw new RoomError(
      ErrorCodes.NOT_A_MEMBER,
      403,
      'Target user is not a current member of this room.',
    );
  }
  if (target.role === 'admin') {
    // Idempotent no-op per AC-MOD-08 rejection-cases list.
    return { role: 'admin' };
  }
  // target.role === 'member' (can't be 'owner' — excluded above)
  const updated = await updateMembershipRole({
    chatId: input.chatId,
    userId: input.targetUserId,
    newRole: 'admin',
  });
  if (updated === undefined) {
    throw new RoomError(
      ErrorCodes.NOT_A_MEMBER,
      403,
      'Target user is not a current member of this room.',
    );
  }
  publishRoomMembershipUpdated({
    chatId: input.chatId,
    userId: input.targetUserId,
    membershipState: 'member',
    role: updated.role,
  });
  return { role: updated.role };
}

export interface InvitationPublic {
  id: string;
  status: 'open' | 'accepted' | 'rejected' | 'revoked' | 'expired';
  roomChatId: string;
  inviteeUserId: string;
  inviteeUsername: string;
  createdAt: string;
}

// AC-INV-01: only the room owner may invite, and the invitee must be an
// active registered user. Existing members and banned users cannot be
// invited (documented guards in state-model.md §11.2 and permissions-
// matrix.md §7). Public rooms are not invitable — invitations are only
// meaningful for private rooms per product-requirements.
export async function createRoomInvitation(input: {
  chatId: string;
  actorUserId: string;
  inviteeUsername: string;
}): Promise<InvitationPublic> {
  const room = await requireActiveRoom(input.chatId);
  if (room.ownerUserId !== input.actorUserId) {
    // Permissions matrix §7: invitations are owner-only. Non-owners get
    // 403 rather than 404 — ownership leak is not a concern because the
    // target is already a room the caller knows about (they supplied
    // the id).
    throw new RoomError(
      ErrorCodes.FORBIDDEN,
      403,
      'Only the room owner may invite users.',
    );
  }
  if (room.visibility !== 'private') {
    throw new RoomError(
      ErrorCodes.VALIDATION_ERROR,
      400,
      'Invitations only apply to private rooms.',
      { field: 'visibility' },
    );
  }
  const trimmedUsername = input.inviteeUsername.trim();
  if (trimmedUsername.length === 0) {
    throw new RoomError(
      ErrorCodes.VALIDATION_ERROR,
      400,
      'Invitee username cannot be empty.',
      { field: 'inviteeUsername' },
    );
  }
  // Exact-match on the stored `username` column (not canonical) so the
  // invitee receives an invite to exactly the account they registered.
  const invitee = await findActiveUserByUsername(trimmedUsername);
  if (invitee === undefined) {
    throw new RoomError(
      ErrorCodes.NOT_FOUND,
      404,
      'Invitee user not found.',
    );
  }
  if (invitee.id === input.actorUserId) {
    throw new RoomError(
      ErrorCodes.VALIDATION_ERROR,
      400,
      'You cannot invite yourself.',
      { field: 'inviteeUsername' },
    );
  }
  if ((await findActiveBan(input.chatId, invitee.id)) !== undefined) {
    // Banned users cannot be invited (state-model.md §11.2 guard); the
    // ban has to be lifted first. Using INVITATION_INVALID keeps the
    // client's error space aligned with accept-time rejections.
    throw new RoomError(
      ErrorCodes.INVITATION_INVALID,
      403,
      'This user is banned from the room.',
    );
  }
  if ((await findActiveMembership(input.chatId, invitee.id)) !== undefined) {
    throw new RoomError(
      ErrorCodes.CONFLICT,
      409,
      'This user is already a member of the room.',
      { reason: 'alreadyMember' },
    );
  }
  const existingOpen = await findOpenInvitation(input.chatId, invitee.id);
  if (existingOpen !== undefined) {
    throw new RoomError(
      ErrorCodes.CONFLICT,
      409,
      'An open invitation for this user already exists.',
      { reason: 'alreadyOpen', invitationId: existingOpen.id },
    );
  }
  let row;
  try {
    row = await insertRoomInvitation({
      roomChatId: input.chatId,
      inviterUserId: input.actorUserId,
      inviteeUserId: invitee.id,
    });
  } catch (err: unknown) {
    // Concurrent inserts can both clear `findOpenInvitation` and race on
    // the `room_invitations_open_uq` partial unique index. Translate
    // that specific violation into the same CONFLICT the preflight
    // would have produced.
    if (
      isUniqueViolation(err) &&
      extractPgConstraint(err) === 'room_invitations_open_uq'
    ) {
      throw new RoomError(
        ErrorCodes.CONFLICT,
        409,
        'An open invitation for this user already exists.',
        { reason: 'alreadyOpen' },
      );
    }
    throw err;
  }
  publishRoomInvitationCreated(
    {
      invitationId: row.id,
      room: { chatId: input.chatId, name: room.name },
    },
    invitee.id,
  );
  return {
    id: row.id,
    status: row.status,
    roomChatId: row.roomChatId,
    inviteeUserId: row.inviteeUserId,
    inviteeUsername: invitee.username,
    createdAt: row.createdAt.toISOString(),
  };
}

// AC-INV-02 / AC-INV-04: the caller must be the invitee, the invitation
// must still be open, and the invitee must not be currently banned.
export async function acceptInvitation(input: {
  chatId: string;
  invitationId: string;
  actorUserId: string;
}): Promise<{ role: 'owner' | 'admin' | 'member' }> {
  const invitation = await findRoomInvitationById(input.invitationId);
  if (
    invitation === undefined ||
    invitation.roomChatId !== input.chatId ||
    invitation.inviteeUserId !== input.actorUserId
  ) {
    // Do not leak whether the invitation exists for someone else — the
    // invitee-scoped 404 covers all three cases uniformly.
    throw new RoomError(
      ErrorCodes.NOT_FOUND,
      404,
      'Invitation not found.',
    );
  }
  const outcome = await acceptRoomInvitation({
    invitationId: input.invitationId,
    inviteeUserId: input.actorUserId,
  });
  if (outcome.kind === 'banned') {
    throw new RoomError(
      ErrorCodes.ROOM_BANNED,
      403,
      'You are banned from this room.',
    );
  }
  if (outcome.kind === 'roomGone') {
    throw new RoomError(ErrorCodes.NOT_FOUND, 404, 'Room not found.');
  }
  if (outcome.kind === 'notOpen') {
    // Re-read to produce the most informative conflict reason for the
    // caller ("already accepted" vs "rejected" vs "revoked").
    const after = await findRoomInvitationById(input.invitationId);
    throw new RoomError(
      ErrorCodes.INVITATION_INVALID,
      409,
      'Invitation is no longer open.',
      { status: after?.status ?? 'unknown' },
    );
  }
  publishRoomMembershipUpdated({
    chatId: input.chatId,
    userId: input.actorUserId,
    membershipState: 'member',
    role: outcome.membership.role,
  });
  return { role: outcome.membership.role };
}

export async function rejectInvitation(input: {
  chatId: string;
  invitationId: string;
  actorUserId: string;
}): Promise<void> {
  const invitation = await findRoomInvitationById(input.invitationId);
  if (
    invitation === undefined ||
    invitation.roomChatId !== input.chatId ||
    invitation.inviteeUserId !== input.actorUserId
  ) {
    throw new RoomError(
      ErrorCodes.NOT_FOUND,
      404,
      'Invitation not found.',
    );
  }
  if (invitation.status !== 'open') {
    throw new RoomError(
      ErrorCodes.INVITATION_INVALID,
      409,
      'Invitation is no longer open.',
      { status: invitation.status },
    );
  }
  const closed = await rejectRoomInvitation({
    invitationId: input.invitationId,
    inviteeUserId: input.actorUserId,
  });
  if (closed === undefined) {
    throw new RoomError(
      ErrorCodes.INVITATION_INVALID,
      409,
      'Invitation is no longer open.',
    );
  }
}

export async function removeAdminStatus(input: {
  chatId: string;
  actorUserId: string;
  targetUserId: string;
}): Promise<{ role: 'owner' | 'admin' | 'member' }> {
  const room = await requireActiveRoom(input.chatId);
  const actorRole = await requireActorMembership(
    input.chatId,
    input.actorUserId,
  );
  assertActorHasModeratorRights(actorRole);
  if (input.targetUserId === room.ownerUserId) {
    // AC-MOD-07: owner admin status cannot be stripped, ever.
    throw new RoomError(
      ErrorCodes.FORBIDDEN,
      403,
      'The owner admin status cannot be removed.',
    );
  }
  const target = await findActiveMembership(input.chatId, input.targetUserId);
  if (target === undefined) {
    throw new RoomError(
      ErrorCodes.NOT_A_MEMBER,
      403,
      'Target user is not a current member of this room.',
    );
  }
  if (target.role !== 'admin') {
    // Idempotent: already a member, nothing to change.
    return { role: target.role };
  }
  const updated = await updateMembershipRole({
    chatId: input.chatId,
    userId: input.targetUserId,
    newRole: 'member',
  });
  if (updated === undefined) {
    throw new RoomError(
      ErrorCodes.NOT_A_MEMBER,
      403,
      'Target user is not a current member of this room.',
    );
  }
  publishRoomMembershipUpdated({
    chatId: input.chatId,
    userId: input.targetUserId,
    membershipState: 'member',
    role: updated.role,
  });
  return { role: updated.role };
}


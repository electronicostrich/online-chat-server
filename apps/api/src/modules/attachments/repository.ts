import { and, eq, isNull, sql } from 'drizzle-orm';
import { db } from '../../db/client.js';
import {
  attachments,
  type AttachmentRow,
} from '../../db/schema/attachments.js';
import { chats } from '../../db/schema/chats.js';
import { messages, type MessageRow } from '../../db/schema/messages.js';
import { roomMemberships } from '../../db/schema/room-memberships.js';
import { directChatParticipants } from '../../db/schema/direct-chat-participants.js';
import { friendships } from '../../db/schema/friendships.js';
import { userBlocks } from '../../db/schema/user-blocks.js';

// Mirrors the WriteAuthScope shape in messages/repository.ts so the
// atomic auth predicates in the upload SQL can be built identically.
export type UploadAuthScope =
  | { kind: 'room'; userId: string }
  | { kind: 'direct'; userId: string; otherUserId: string };

function callerIsActiveRoomMember(chatId: string, userId: string) {
  return sql`EXISTS (
    SELECT 1 FROM ${roomMemberships}
    WHERE ${roomMemberships.roomChatId} = ${chatId}
      AND ${roomMemberships.userId} = ${userId}
      AND ${roomMemberships.leftAt} IS NULL
  )`;
}

function dmPairStillEligible(chatId: string, callerUserId: string, otherUserId: string) {
  const [low, high] =
    callerUserId < otherUserId ? [callerUserId, otherUserId] : [otherUserId, callerUserId];
  return sql`(
    EXISTS (
      SELECT 1 FROM ${directChatParticipants}
      WHERE ${directChatParticipants.chatId} = ${chatId}
        AND ${directChatParticipants.userId} = ${callerUserId}
    )
    AND EXISTS (
      SELECT 1 FROM ${friendships}
      WHERE ${friendships.userLowId} = ${low}
        AND ${friendships.userHighId} = ${high}
        AND ${friendships.endedAt} IS NULL
    )
    AND NOT EXISTS (
      SELECT 1 FROM ${userBlocks}
      WHERE ((${userBlocks.blockerUserId} = ${callerUserId} AND ${userBlocks.blockedUserId} = ${otherUserId})
          OR (${userBlocks.blockerUserId} = ${otherUserId} AND ${userBlocks.blockedUserId} = ${callerUserId}))
        AND ${userBlocks.removedAt} IS NULL
    )
  )`;
}

function buildAuthPredicate(chatId: string, scope: UploadAuthScope) {
  return scope.kind === 'room'
    ? callerIsActiveRoomMember(chatId, scope.userId)
    : dmPairStillEligible(chatId, scope.userId, scope.otherUserId);
}

export interface InsertAttachmentParams {
  attachmentId: string;
  chatId: string;
  uploaderUserId: string;
  originalFilename: string;
  storagePath: string;
  mimeType: string | null;
  sizeBytes: number;
  commentText: string | null;
  authScope: UploadAuthScope;
}

export interface InsertAttachmentResult {
  attachment: AttachmentRow;
  message: MessageRow;
  nextSequence: number;
}

// Atomically (a) bumps the chat's `current_sequence`, (b) inserts a
// `kind='attachment'` message row carrying the caller's optional comment
// text, and (c) inserts the attachment metadata row linked to that
// message. The `authPredicate` folded into the chat UPDATE guarantees
// the room membership / DM eligibility hasn't been revoked since the
// service-level preflight. A match of zero rows (chat soft-deleted,
// membership revoked, DM frozen) returns `undefined` so the service
// can map to the right 404/403 response without guessing which race
// lost.
export async function insertAttachmentWithMessage(
  params: InsertAttachmentParams,
): Promise<InsertAttachmentResult | undefined> {
  return db.transaction(async (tx) => {
    const authPredicate = buildAuthPredicate(params.chatId, params.authScope);
    const [updatedChat] = await tx
      .update(chats)
      .set({ currentSequence: sql`${chats.currentSequence} + 1` })
      .where(and(eq(chats.id, params.chatId), isNull(chats.deletedAt), authPredicate))
      .returning({ currentSequence: chats.currentSequence });
    if (updatedChat === undefined) return undefined;
    const nextSequence = updatedChat.currentSequence;
    const [messageRow] = await tx
      .insert(messages)
      .values({
        chatId: params.chatId,
        sequence: nextSequence,
        authorUserId: params.uploaderUserId,
        kind: 'attachment',
        bodyText: params.commentText,
      })
      .returning();
    if (messageRow === undefined) {
      throw new Error('insertAttachmentWithMessage: message insert returned no row');
    }
    const [attachmentRow] = await tx
      .insert(attachments)
      .values({
        id: params.attachmentId,
        chatId: params.chatId,
        messageId: messageRow.id,
        uploadedByUserId: params.uploaderUserId,
        originalFilename: params.originalFilename,
        storagePath: params.storagePath,
        mimeType: params.mimeType,
        sizeBytes: params.sizeBytes,
        commentText: params.commentText,
      })
      .returning();
    if (attachmentRow === undefined) {
      throw new Error('insertAttachmentWithMessage: attachment insert returned no row');
    }
    return { attachment: attachmentRow, message: messageRow, nextSequence };
  });
}

export async function findAttachmentById(
  attachmentId: string,
): Promise<AttachmentRow | undefined> {
  const rows = await db
    .select()
    .from(attachments)
    .where(eq(attachments.id, attachmentId))
    .limit(1);
  return rows[0];
}

// Returns the chat type + direct-chat participant ids for the chat that
// holds this attachment, in a single round-trip. We use this for the
// download path's authz check — the attachment row's `chat_id` is
// load-bearing for access control, so we want the auth check to read
// from the *same* row rather than a separately-loaded chat context.
// Returns undefined if the chat has been soft-deleted (which collapses
// to 404 for the caller, AC-ATT-04).
export async function loadChatForDownload(chatId: string): Promise<
  | {
      type: 'room' | 'direct';
      directParticipantIds: string[] | null;
    }
  | undefined
> {
  const rows = await db
    .select({ type: chats.type })
    .from(chats)
    .where(and(eq(chats.id, chatId), isNull(chats.deletedAt)))
    .limit(1);
  const row = rows[0];
  if (row === undefined) return undefined;
  if (row.type === 'room') {
    return { type: 'room', directParticipantIds: null };
  }
  const participants = await db
    .select({ userId: directChatParticipants.userId })
    .from(directChatParticipants)
    .where(eq(directChatParticipants.chatId, chatId));
  return {
    type: 'direct',
    directParticipantIds: participants.map((p) => p.userId),
  };
}

export async function isActiveRoomMember(chatId: string, userId: string): Promise<boolean> {
  const rows = await db
    .select({ userId: roomMemberships.userId })
    .from(roomMemberships)
    .where(
      and(
        eq(roomMemberships.roomChatId, chatId),
        eq(roomMemberships.userId, userId),
        isNull(roomMemberships.leftAt),
      ),
    )
    .limit(1);
  return rows.length > 0;
}

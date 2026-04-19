import { and, desc, eq, gt, isNull, lt, sql } from 'drizzle-orm';
import { db, pgSql } from '../../db/client.js';
import { messages, type MessageRow } from '../../db/schema/messages.js';
import { chats, type ChatRow } from '../../db/schema/chats.js';
import { roomMemberships } from '../../db/schema/room-memberships.js';
import { directChatParticipants } from '../../db/schema/direct-chat-participants.js';
import { rooms } from '../../db/schema/rooms.js';
import type { ChatReadStateRow } from '../../db/schema/chat-read-state.js';
import { friendships } from '../../db/schema/friendships.js';
import { userBlocks } from '../../db/schema/user-blocks.js';

export interface ChatContext {
  chat: ChatRow;
  roomOwnerUserId: string | null;
  directParticipantIds: string[] | null;
}

export async function loadChatContext(chatId: string): Promise<ChatContext | undefined> {
  const chatRows = await db
    .select()
    .from(chats)
    .where(and(eq(chats.id, chatId), isNull(chats.deletedAt)))
    .limit(1);
  const chat = chatRows[0];
  if (chat === undefined) return undefined;
  if (chat.type === 'room') {
    const roomRows = await db
      .select({ ownerUserId: rooms.ownerUserId })
      .from(rooms)
      .where(and(eq(rooms.chatId, chatId), isNull(rooms.deletedAt)))
      .limit(1);
    const owner = roomRows[0]?.ownerUserId ?? null;
    return { chat, roomOwnerUserId: owner, directParticipantIds: null };
  }
  const participantRows = await db
    .select({ userId: directChatParticipants.userId })
    .from(directChatParticipants)
    .where(eq(directChatParticipants.chatId, chatId));
  return {
    chat,
    roomOwnerUserId: null,
    directParticipantIds: participantRows.map((r) => r.userId),
  };
}

export async function isActiveRoomMember(
  roomChatId: string,
  userId: string,
): Promise<{ role: 'owner' | 'admin' | 'member' } | undefined> {
  const rows = await db
    .select({ role: roomMemberships.role })
    .from(roomMemberships)
    .where(
      and(
        eq(roomMemberships.roomChatId, roomChatId),
        eq(roomMemberships.userId, userId),
        isNull(roomMemberships.leftAt),
      ),
    )
    .limit(1);
  return rows[0];
}

export async function hasActiveFriendship(aUserId: string, bUserId: string): Promise<boolean> {
  const [low, high] = aUserId < bUserId ? [aUserId, bUserId] : [bUserId, aUserId];
  const rows = await db
    .select({ id: friendships.id })
    .from(friendships)
    .where(
      and(
        eq(friendships.userLowId, low),
        eq(friendships.userHighId, high),
        isNull(friendships.endedAt),
      ),
    )
    .limit(1);
  return rows.length > 0;
}

export async function hasActiveBlockBetween(aUserId: string, bUserId: string): Promise<boolean> {
  const rows = await db
    .select({ id: userBlocks.id })
    .from(userBlocks)
    .where(
      and(
        isNull(userBlocks.removedAt),
        sql`(
          (${userBlocks.blockerUserId} = ${aUserId} AND ${userBlocks.blockedUserId} = ${bUserId})
          OR
          (${userBlocks.blockerUserId} = ${bUserId} AND ${userBlocks.blockedUserId} = ${aUserId})
        )`,
      ),
    )
    .limit(1);
  return rows.length > 0;
}

export interface InsertMessageParams {
  chatId: string;
  authorUserId: string;
  bodyText: string;
  replyToMessageId?: string | null;
}

// Atomically increments the chat's `current_sequence` and inserts the
// message with the allocated value. The `UPDATE ... RETURNING
// current_sequence` guarantees exactly one allocation per caller even
// under concurrent `POST /chats/{id}/messages` calls because the row
// lock serialises them.
export async function insertMessageWithSequence(
  params: InsertMessageParams,
): Promise<{ message: MessageRow; nextSequence: number }> {
  return db.transaction(async (tx) => {
    const [updatedChat] = await tx
      .update(chats)
      .set({ currentSequence: sql`${chats.currentSequence} + 1` })
      .where(and(eq(chats.id, params.chatId), isNull(chats.deletedAt)))
      .returning({ currentSequence: chats.currentSequence });
    if (updatedChat === undefined) {
      throw new Error('insertMessageWithSequence: chat not found or deleted');
    }
    const nextSequence = updatedChat.currentSequence;
    const [row] = await tx
      .insert(messages)
      .values({
        chatId: params.chatId,
        sequence: nextSequence,
        authorUserId: params.authorUserId,
        kind: 'text',
        bodyText: params.bodyText,
        replyToMessageId: params.replyToMessageId ?? null,
      })
      .returning();
    if (row === undefined) {
      throw new Error('insertMessageWithSequence: insert returned no row');
    }
    return { message: row, nextSequence };
  });
}

export async function findMessageById(messageId: string): Promise<MessageRow | undefined> {
  const rows = await db.select().from(messages).where(eq(messages.id, messageId)).limit(1);
  return rows[0];
}

// Asserts the message's parent chat is still active. Without this,
// a chat that gets soft-deleted after the service-level authz check
// but before this UPDATE would still accept mutations on a tombstoned
// chat. Expressed as an EXISTS subquery so the predicate lives inside
// the UPDATE itself and the write fails atomically.
const parentChatIsActive = sql`EXISTS (
  SELECT 1 FROM ${chats}
  WHERE ${chats.id} = ${messages.chatId} AND ${chats.deletedAt} IS NULL
)`;

export async function updateMessageBody(params: {
  messageId: string;
  authorUserId: string;
  bodyText: string;
}): Promise<MessageRow | undefined> {
  const now = new Date();
  const [row] = await db
    .update(messages)
    .set({ bodyText: params.bodyText, editedAt: now, updatedAt: now })
    .where(
      and(
        eq(messages.id, params.messageId),
        eq(messages.authorUserId, params.authorUserId),
        isNull(messages.deletedAt),
        parentChatIsActive,
      ),
    )
    .returning();
  return row;
}

export async function softDeleteMessage(params: {
  messageId: string;
  deletedByUserId: string;
}): Promise<MessageRow | undefined> {
  const now = new Date();
  const [row] = await db
    .update(messages)
    .set({
      deletedAt: now,
      deletedByUserId: params.deletedByUserId,
      updatedAt: now,
    })
    .where(
      and(
        eq(messages.id, params.messageId),
        isNull(messages.deletedAt),
        parentChatIsActive,
      ),
    )
    .returning();
  return row;
}

export interface ListMessagesParams {
  chatId: string;
  beforeSequence?: number | undefined;
  afterSequence?: number | undefined;
  limit: number;
}

// Loads the chat's current head-sequence and the requested page of
// messages in a single transaction, so authz and listing see the same
// chat snapshot. Without this, a concurrent send between
// `loadChatContext()` and the list query could return messages newer
// than the reported `headSequence`, and a concurrent soft-delete of
// the chat could let history leak past the tombstone. The
// `sequence <= chat.currentSequence` predicate clamps to the snapshot
// head; the `deleted_at IS NULL` check returns `undefined` so the
// caller can map to a 404.
export async function loadActiveChatMessageSnapshot(params: ListMessagesParams): Promise<
  | {
      chat: ChatRow;
      messages: MessageRow[];
    }
  | undefined
> {
  return db.transaction(async (tx) => {
    const chatRows = await tx
      .select()
      .from(chats)
      .where(and(eq(chats.id, params.chatId), isNull(chats.deletedAt)))
      .limit(1);
    const chat = chatRows[0];
    if (chat === undefined) return undefined;

    const predicates = [
      eq(messages.chatId, params.chatId),
      sql`${messages.sequence} <= ${chat.currentSequence}`,
    ];
    if (params.beforeSequence !== undefined) {
      predicates.push(lt(messages.sequence, params.beforeSequence));
    }
    if (params.afterSequence !== undefined) {
      predicates.push(gt(messages.sequence, params.afterSequence));
    }
    const rows = await tx
      .select()
      .from(messages)
      .where(and(...predicates))
      .orderBy(desc(messages.sequence))
      .limit(params.limit);
    return { chat, messages: rows };
  });
}

export async function findDirectChatBetween(
  aUserId: string,
  bUserId: string,
): Promise<ChatRow | undefined> {
  // A direct chat is identified by the two participant rows both
  // pointing at the same chat. The `innerJoin` picks the caller's side;
  // the `EXISTS` subquery asserts the other participant is present too.
  // The `deleted_at IS NULL` filter keeps historically frozen-then-purged
  // chats from resurrecting.
  const rows = await db
    .select({
      id: chats.id,
      type: chats.type,
      currentSequence: chats.currentSequence,
      createdAt: chats.createdAt,
      deletedAt: chats.deletedAt,
    })
    .from(chats)
    .innerJoin(
      directChatParticipants,
      and(
        eq(directChatParticipants.chatId, chats.id),
        eq(directChatParticipants.userId, aUserId),
      ),
    )
    .where(
      and(
        eq(chats.type, 'direct'),
        isNull(chats.deletedAt),
        sql`EXISTS (
          SELECT 1 FROM direct_chat_participants p2
          WHERE p2.chat_id = ${chats.id} AND p2.user_id = ${bUserId}
        )`,
      ),
    )
    .limit(1);
  return rows[0];
}

export interface FirstDirectMessageResult {
  chat: ChatRow;
  chatCreated: boolean;
  message: MessageRow;
}

// Creates a direct chat (if missing), then allocates and inserts the
// first message. Re-used for subsequent sends as long as the caller is
// still authorized; the `chatCreated` flag tells the client whether this
// call materialized the chat.
export async function createDirectChatAndInsertMessage(params: {
  senderUserId: string;
  recipientUserId: string;
  bodyText: string;
  replyToMessageId?: string | null;
}): Promise<FirstDirectMessageResult> {
  return db.transaction(async (tx) => {
    // Serialize any concurrent first-DM attempts for the same ordered
    // pair. Without this, two transactions could both fail the
    // "existing direct chat" lookup, create distinct `chats` rows, and
    // each insert their own `(chat_id, user_id)` pair — giving the pair
    // two DMs and splitting history. The advisory lock is scoped to
    // the transaction and uses a 64-bit hash of the sorted pair as the
    // key; `hashtextextended` is a built-in and returns `bigint`, so
    // there's no collision-class concern beyond ordinary hash birthday
    // math for this in-process counter.
    const [low, high] =
      params.senderUserId < params.recipientUserId
        ? [params.senderUserId, params.recipientUserId]
        : [params.recipientUserId, params.senderUserId];
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtextextended(${low} || '|' || ${high}, 0))`,
    );

    // Find the single chat both participants share. The `innerJoin` +
    // `EXISTS` subquery expresses the symmetric pair lookup through
    // Drizzle's typed query builder, so the returned row comes back as a
    // `ChatRow` without needing raw SQL casts. The deleted_at filter
    // keeps historically frozen-then-purged chats from resurrecting.
    const existingRows = await tx
      .select({
        id: chats.id,
        type: chats.type,
        currentSequence: chats.currentSequence,
        createdAt: chats.createdAt,
        deletedAt: chats.deletedAt,
      })
      .from(chats)
      .innerJoin(
        directChatParticipants,
        and(
          eq(directChatParticipants.chatId, chats.id),
          eq(directChatParticipants.userId, params.senderUserId),
        ),
      )
      .where(
        and(
          eq(chats.type, 'direct'),
          isNull(chats.deletedAt),
          sql`EXISTS (
            SELECT 1 FROM direct_chat_participants p2
            WHERE p2.chat_id = ${chats.id} AND p2.user_id = ${params.recipientUserId}
          )`,
        ),
      )
      .limit(1)
      .for('update');
    const existing = existingRows[0];

    let chatRow: ChatRow;
    let chatCreated = false;
    if (existing !== undefined) {
      chatRow = existing;
    } else {
      const [createdChat] = await tx.insert(chats).values({ type: 'direct' }).returning();
      if (createdChat === undefined) {
        throw new Error('createDirectChatAndInsertMessage: chat insert failed');
      }
      await tx.insert(directChatParticipants).values([
        { chatId: createdChat.id, userId: params.senderUserId },
        { chatId: createdChat.id, userId: params.recipientUserId },
      ]);
      chatRow = createdChat;
      chatCreated = true;
    }

    const [updatedChat] = await tx
      .update(chats)
      .set({ currentSequence: sql`${chats.currentSequence} + 1` })
      .where(eq(chats.id, chatRow.id))
      .returning({ currentSequence: chats.currentSequence });
    if (updatedChat === undefined) {
      throw new Error('createDirectChatAndInsertMessage: sequence bump failed');
    }
    const nextSequence = updatedChat.currentSequence;

    const [messageRow] = await tx
      .insert(messages)
      .values({
        chatId: chatRow.id,
        sequence: nextSequence,
        authorUserId: params.senderUserId,
        kind: 'text',
        bodyText: params.bodyText,
        replyToMessageId: params.replyToMessageId ?? null,
      })
      .returning();
    if (messageRow === undefined) {
      throw new Error('createDirectChatAndInsertMessage: message insert failed');
    }

    return { chat: chatRow, chatCreated, message: messageRow };
  });
}

export async function findUserActive(userId: string): Promise<{ id: string } | undefined> {
  // `status = 'active'` should be sufficient since the soft-delete writer
  // flips both fields in lockstep, but belt-and-braces matches the
  // convention used by `getReadState` and other chat-side queries.
  const rows = await pgSql<{ id: string }[]>`
    SELECT id FROM users
    WHERE id = ${userId} AND status = 'active' AND deleted_at IS NULL
    LIMIT 1
  `;
  return rows[0];
}

interface RawChatReadStateRow {
  chat_id: string;
  user_id: string;
  last_read_sequence: string | number;
  last_opened_at: Date | string | null;
  updated_at: Date | string;
}

function mapRawReadState(row: RawChatReadStateRow): ChatReadStateRow {
  return {
    chatId: row.chat_id,
    userId: row.user_id,
    lastReadSequence: Number(row.last_read_sequence),
    lastOpenedAt:
      row.last_opened_at === null
        ? null
        : row.last_opened_at instanceof Date
          ? row.last_opened_at
          : new Date(row.last_opened_at),
    updatedAt: row.updated_at instanceof Date ? row.updated_at : new Date(row.updated_at),
  };
}

export async function upsertReadState(params: {
  chatId: string;
  userId: string;
  readUpToSequence: number;
}): Promise<ChatReadStateRow | undefined> {
  // INSERT ... SELECT against chats with `deleted_at IS NULL`: if the
  // chat is soft-deleted between service-level authz and this upsert,
  // the SELECT returns zero rows, no INSERT happens, the ON CONFLICT
  // path does not fire, and RETURNING yields nothing. The caller maps
  // that to a 404 so read-state can't be clamped against a tombstoned
  // chat. EXCLUDED.last_read_sequence reuses the SELECT-clamped value
  // on the conflict path so it stays consistent with the insert path.
  //
  // Note: we intentionally let postgres set the timestamps via NOW() rather
  // than passing a Date from JS. Postgres-js's raw tagged-template path
  // cannot bind a naked `Date` without a known column type hint (ERR_INVALID_ARG_TYPE
  // from `Buffer.byteLength` when it tries to wire a Date), so using NOW()
  // on the server side both avoids that pitfall and keeps read-state
  // timestamps in DB-clock time.
  const rows = await pgSql<RawChatReadStateRow[]>`
    INSERT INTO chat_read_state (chat_id, user_id, last_read_sequence, last_opened_at, updated_at)
    SELECT
      c.id,
      ${params.userId},
      LEAST(${params.readUpToSequence}, COALESCE(c.current_sequence, 0)),
      NOW(),
      NOW()
    FROM chats c
    WHERE c.id = ${params.chatId} AND c.deleted_at IS NULL
    ON CONFLICT (chat_id, user_id) DO UPDATE
    SET
      last_read_sequence = GREATEST(
        chat_read_state.last_read_sequence,
        EXCLUDED.last_read_sequence
      ),
      last_opened_at = NOW(),
      updated_at = NOW()
    RETURNING *
  `;
  const first = rows[0];
  if (first === undefined) return undefined;
  return mapRawReadState(first);
}

export async function getReadState(params: {
  chatId: string;
  userId: string;
}): Promise<{ lastReadSequence: number; headSequence: number } | undefined> {
  const rows = await pgSql<
    {
      last_read_sequence: string | number;
      head_sequence: string | number;
    }[]
  >`
    SELECT
      COALESCE(rs.last_read_sequence, 0) AS last_read_sequence,
      c.current_sequence AS head_sequence
    FROM chats c
    LEFT JOIN chat_read_state rs
      ON rs.chat_id = c.id AND rs.user_id = ${params.userId}
    WHERE c.id = ${params.chatId} AND c.deleted_at IS NULL
    LIMIT 1
  `;
  const first = rows[0];
  if (first === undefined) return undefined;
  return {
    lastReadSequence: Number(first.last_read_sequence),
    headSequence: Number(first.head_sequence),
  };
}

import {
  ErrorCodes,
  MESSAGE_MAX_BYTES,
  PAGINATION_CURSOR_DEFAULT_LIMIT,
  PAGINATION_CURSOR_MAX_LIMIT,
  type MessagePublic,
} from 'shared-schemas';
import type { MessageRow } from '../../db/schema/messages.js';
import {
  publishMessageCreated,
  publishMessageDeleted,
  publishMessageEdited,
  publishReadstateUpdated,
} from '../realtime/index.js';
import { MessageError } from './errors.js';
import {
  createDirectChatAndInsertMessage,
  DmEligibilityRevokedError,
  findDirectChatBetween,
  findMessageById,
  findUserActive,
  getReadState,
  hasActiveBlockBetween,
  hasActiveFriendship,
  insertMessageWithSequence,
  isActiveRoomMember,
  loadActiveChatMessageSnapshot,
  loadChatContext,
  softDeleteMessage,
  updateMessageBody,
  upsertReadState,
  type ChatContext,
  type ReadAuthScope,
  type WriteAuthScope,
} from './repository.js';

const TEXT_ENCODER = new TextEncoder();

function validateBody(bodyText: string): string {
  // Reject whitespace-only bodies: `'   '`, `'\n'`, etc. would otherwise
  // persist as "real" messages that render blank in the UI. We still
  // keep the original body (not trimmed) because leading/trailing
  // whitespace inside a multi-line code paste can be meaningful.
  if (bodyText.trim().length === 0) {
    throw new MessageError(ErrorCodes.VALIDATION_ERROR, 400, 'Message body cannot be empty.', {
      field: 'bodyText',
    });
  }
  // AC-MSG-02: measure the UTF-8 byte length, not the JS code-unit count,
  // so emoji and non-Latin scripts aren't accidentally allowed past 3 KB.
  const bytes = TEXT_ENCODER.encode(bodyText).byteLength;
  if (bytes > MESSAGE_MAX_BYTES) {
    throw new MessageError(
      ErrorCodes.VALIDATION_ERROR,
      400,
      'Message body exceeds the 3 KB limit.',
      { field: 'bodyText', maxBytes: MESSAGE_MAX_BYTES, actualBytes: bytes },
    );
  }
  return bodyText;
}

// Translates a loaded ChatContext into the repository-side write scope
// so the mutation SQL can atomically re-verify the same predicates that
// `requireChatWriteAccess` just checked. The room scope captures the
// caller's user id; the direct scope captures both participants so the
// repository's friendship/block subqueries can be built without another
// round trip to the DB.
function buildWriteScope(ctx: ChatContext, userId: string): WriteAuthScope {
  if (ctx.chat.type === 'room') return { kind: 'room', userId };
  const otherUserId = ctx.directParticipantIds?.find((id) => id !== userId);
  if (otherUserId === undefined) {
    // `requireChatWriteAccess` has already rejected this shape, but
    // defensive guard keeps the union exhaustive.
    throw new MessageError(ErrorCodes.FORBIDDEN, 403, 'You are not a participant in this chat.');
  }
  return { kind: 'direct', userId, otherUserId };
}

function buildReadScope(ctx: ChatContext, userId: string): ReadAuthScope {
  return ctx.chat.type === 'room' ? { kind: 'room', userId } : { kind: 'direct', userId };
}

async function requireChatWriteAccess(chatId: string, userId: string): Promise<ChatContext> {
  const ctx = await loadChatContext(chatId);
  if (ctx === undefined) {
    throw new MessageError(ErrorCodes.NOT_FOUND, 404, 'Chat not found.');
  }
  if (ctx.chat.type === 'room') {
    const membership = await isActiveRoomMember(chatId, userId);
    if (membership === undefined) {
      throw new MessageError(ErrorCodes.NOT_A_MEMBER, 403, 'You are not a member of this room.');
    }
    return ctx;
  }
  // Direct chat: caller must be one of the two participants, and DM
  // eligibility rules (AC-DM-04 / AC-DM-06) must still hold.
  const otherUserId = ctx.directParticipantIds?.find((id) => id !== userId);
  if (
    ctx.directParticipantIds === null ||
    !ctx.directParticipantIds.includes(userId) ||
    otherUserId === undefined
  ) {
    throw new MessageError(ErrorCodes.FORBIDDEN, 403, 'You are not a participant in this chat.');
  }
  if (await hasActiveBlockBetween(userId, otherUserId)) {
    throw new MessageError(
      ErrorCodes.DM_NOT_ALLOWED,
      403,
      'Direct messages are not allowed between these users.',
    );
  }
  if (!(await hasActiveFriendship(userId, otherUserId))) {
    throw new MessageError(
      ErrorCodes.DM_NOT_ALLOWED,
      403,
      'Direct messages require an active friendship.',
    );
  }
  return ctx;
}

export async function sendMessageToChat(input: {
  chatId: string;
  senderUserId: string;
  bodyText: string;
  replyToMessageId?: string | null;
}): Promise<MessageRow> {
  const body = validateBody(input.bodyText);
  const ctx = await requireChatWriteAccess(input.chatId, input.senderUserId);
  if (input.replyToMessageId !== undefined && input.replyToMessageId !== null) {
    const replyTarget = await findMessageById(input.replyToMessageId);
    // Soft-deleted targets are indistinguishable from cold misses to the
    // client: the body is already scrubbed on public render, so a reply
    // quoting a tombstone would display as a dangling pointer. Reject
    // them the same way we'd reject a non-existent target.
    if (
      replyTarget === undefined ||
      replyTarget.deletedAt !== null ||
      replyTarget.chatId !== input.chatId
    ) {
      throw new MessageError(
        ErrorCodes.VALIDATION_ERROR,
        400,
        'Reply target must belong to the same chat.',
        { field: 'replyToMessageId' },
      );
    }
  }
  const result = await insertMessageWithSequence({
    chatId: input.chatId,
    authorUserId: input.senderUserId,
    bodyText: body,
    replyToMessageId: input.replyToMessageId ?? null,
    authScope: buildWriteScope(ctx, input.senderUserId),
  });
  if (result === undefined) {
    // The chat was soft-deleted, the caller's room membership was
    // revoked, or the DM friendship/block flipped between the preflight
    // and the insert. Surface it as a 403 mirroring the preflight's
    // rejection shape.
    throw new MessageError(
      ErrorCodes.FORBIDDEN,
      403,
      'Lost write access to this chat before the message could be sent.',
    );
  }
  publishMessageCreated({
    chatId: input.chatId,
    headSequence: result.nextSequence,
    message: messageRowToPublic(result.message),
  });
  return result.message;
}

export async function sendDirectMessage(input: {
  senderUserId: string;
  recipientUserId: string;
  bodyText: string;
  replyToMessageId?: string | null;
}): Promise<{
  message: MessageRow;
  chatId: string;
  chatCreated: boolean;
}> {
  const body = validateBody(input.bodyText);
  if (input.recipientUserId === input.senderUserId) {
    throw new MessageError(ErrorCodes.VALIDATION_ERROR, 400, 'Cannot direct message yourself.', {
      field: 'userId',
    });
  }
  const recipient = await findUserActive(input.recipientUserId);
  if (recipient === undefined) {
    throw new MessageError(ErrorCodes.NOT_FOUND, 404, 'Recipient user not found.');
  }
  // AC-DM-04 / AC-DM-06: direct messaging requires an active friendship
  // AND no block in either direction. Evaluate block first so a blocked
  // pair can't probe for friendship status by message code.
  if (await hasActiveBlockBetween(input.senderUserId, input.recipientUserId)) {
    throw new MessageError(
      ErrorCodes.DM_NOT_ALLOWED,
      403,
      'Direct messages are not allowed between these users.',
    );
  }
  if (!(await hasActiveFriendship(input.senderUserId, input.recipientUserId))) {
    throw new MessageError(
      ErrorCodes.DM_NOT_ALLOWED,
      403,
      'Direct messages require an active friendship.',
    );
  }

  if (input.replyToMessageId !== undefined && input.replyToMessageId !== null) {
    // The reply-target must belong to the existing direct chat (if any)
    // and the caller must already be a participant. A reply is never
    // valid when the chat is about to be created for the first time.
    const existing = await findDirectChatBetween(input.senderUserId, input.recipientUserId);
    const replyTarget = await findMessageById(input.replyToMessageId);
    // Same rationale as `sendMessageToChat`: a tombstoned reply target
    // renders as a dangling pointer in the UI, so treat it like a cold
    // miss instead of letting the reply record the FK.
    if (
      existing === undefined ||
      replyTarget === undefined ||
      replyTarget.deletedAt !== null ||
      replyTarget.chatId !== existing.id
    ) {
      throw new MessageError(
        ErrorCodes.VALIDATION_ERROR,
        400,
        'Reply target must belong to the same chat.',
        { field: 'replyToMessageId' },
      );
    }
  }

  try {
    const result = await createDirectChatAndInsertMessage({
      senderUserId: input.senderUserId,
      recipientUserId: input.recipientUserId,
      bodyText: body,
      replyToMessageId: input.replyToMessageId ?? null,
    });
    publishMessageCreated({
      chatId: result.chat.id,
      headSequence: result.message.sequence,
      message: messageRowToPublic(result.message),
    });
    return {
      message: result.message,
      chatId: result.chat.id,
      chatCreated: result.chatCreated,
    };
  } catch (err) {
    if (err instanceof DmEligibilityRevokedError) {
      // Friendship ended or a block landed between the service-level
      // preflight and the in-tx re-check. Surface the same
      // DM_NOT_ALLOWED response shape the preflight would have thrown
      // so callers don't have to special-case a race condition.
      throw new MessageError(
        ErrorCodes.DM_NOT_ALLOWED,
        403,
        'Direct messages are not allowed between these users.',
      );
    }
    throw err;
  }
}

export async function editOwnMessage(input: {
  messageId: string;
  authorUserId: string;
  bodyText: string;
}): Promise<MessageRow> {
  const body = validateBody(input.bodyText);
  const existing = await findMessageById(input.messageId);
  if (existing === undefined || existing.deletedAt !== null) {
    throw new MessageError(ErrorCodes.NOT_FOUND, 404, 'Message not found.');
  }
  if (existing.authorUserId !== input.authorUserId) {
    throw new MessageError(ErrorCodes.FORBIDDEN, 403, 'Only the author may edit this message.');
  }
  // Caller must still have write access to the containing chat (e.g.
  // banned from the room, DM became frozen). Re-using the same gate as
  // send keeps the rule in one place.
  const ctx = await requireChatWriteAccess(existing.chatId, input.authorUserId);
  const updated = await updateMessageBody({
    messageId: input.messageId,
    chatId: existing.chatId,
    authorUserId: input.authorUserId,
    bodyText: body,
    authScope: buildWriteScope(ctx, input.authorUserId),
  });
  if (updated === undefined) {
    // Either another caller deleted the message or the caller's write
    // access was revoked (left the room, friendship ended, block
    // added) between the preflight and the UPDATE. In both cases the
    // caller can no longer see/mutate the message, so a 404 is the
    // right response.
    throw new MessageError(ErrorCodes.NOT_FOUND, 404, 'Message not found.');
  }
  // `updateMessageBody` always sets `edited_at` and `body_text` on a
  // successful edit (see repository.ts). The nullable guard here is a
  // type-system concession, not a real runtime branch.
  if (updated.editedAt !== null && updated.bodyText !== null) {
    publishMessageEdited({
      chatId: updated.chatId,
      messageId: updated.id,
      sequence: updated.sequence,
      bodyText: updated.bodyText,
      editedAt: updated.editedAt.toISOString(),
    });
  }
  return updated;
}

export async function deleteMessage(input: {
  messageId: string;
  callerUserId: string;
}): Promise<void> {
  const existing = await findMessageById(input.messageId);
  if (existing === undefined || existing.deletedAt !== null) {
    throw new MessageError(ErrorCodes.NOT_FOUND, 404, 'Message not found.');
  }
  const ctx = await loadChatContext(existing.chatId);
  if (ctx === undefined) {
    throw new MessageError(ErrorCodes.NOT_FOUND, 404, 'Chat not found.');
  }
  const isAuthor = existing.authorUserId === input.callerUserId;
  if (ctx.chat.type === 'room') {
    const membership = await isActiveRoomMember(existing.chatId, input.callerUserId);
    if (membership === undefined) {
      throw new MessageError(ErrorCodes.NOT_A_MEMBER, 403, 'You are not a member of this room.');
    }
    const canModerate = membership.role === 'admin' || membership.role === 'owner';
    if (!isAuthor && !canModerate) {
      throw new MessageError(
        ErrorCodes.FORBIDDEN,
        403,
        'Only the author, a room admin, or the owner may delete this message.',
      );
    }
  } else {
    // AC-MSG-06: direct chats have no admin role — participants can only
    // delete their own messages.
    if (
      ctx.directParticipantIds === null ||
      !ctx.directParticipantIds.includes(input.callerUserId)
    ) {
      throw new MessageError(ErrorCodes.FORBIDDEN, 403, 'You are not a participant in this chat.');
    }
    if (!isAuthor) {
      throw new MessageError(ErrorCodes.FORBIDDEN, 403, 'Only the author may delete this message.');
    }
  }
  const deleted = await softDeleteMessage({
    messageId: input.messageId,
    chatId: existing.chatId,
    deletedByUserId: input.callerUserId,
    // For rooms, the repository re-asserts membership AND (caller ==
    // message.author OR role IN ('admin','owner')) atomically so a
    // concurrent membership/role revocation can't slip past the
    // preflight check above. Direct chats don't need an atomic
    // predicate: the only change that matters is the chat being
    // soft-deleted, which `parentChatIsActive` already covers.
    authScope:
      ctx.chat.type === 'room' ? { kind: 'room', callerUserId: input.callerUserId } : { kind: 'direct' },
  });
  if (deleted === undefined) {
    // Message was already deleted, chat was soft-deleted, or room
    // membership/role changed between the preflight and the UPDATE.
    // 404 mirrors what a cold caller would see.
    throw new MessageError(ErrorCodes.NOT_FOUND, 404, 'Message not found.');
  }
  if (deleted.deletedAt !== null) {
    publishMessageDeleted({
      chatId: deleted.chatId,
      messageId: deleted.id,
      sequence: deleted.sequence,
      deletedAt: deleted.deletedAt.toISOString(),
    });
  }
}

export async function fetchMessagesForChat(input: {
  chatId: string;
  callerUserId: string;
  beforeSequence?: number | undefined;
  afterSequence?: number | undefined;
  limit?: number | undefined;
}): Promise<{
  chatId: string;
  headSequence: number;
  messages: MessagePublic[];
}> {
  const ctx = await loadChatContext(input.chatId);
  if (ctx === undefined) {
    throw new MessageError(ErrorCodes.NOT_FOUND, 404, 'Chat not found.');
  }
  // Read access mirrors write access: room membership OR direct-chat
  // participation. DM history stays visible even if a block/unfriend
  // froze the chat, per AC-DM-06. So we don't call the full
  // write-access check here.
  if (ctx.chat.type === 'room') {
    if ((await isActiveRoomMember(input.chatId, input.callerUserId)) === undefined) {
      throw new MessageError(ErrorCodes.NOT_A_MEMBER, 403, 'You are not a member of this room.');
    }
  } else {
    if (
      ctx.directParticipantIds === null ||
      !ctx.directParticipantIds.includes(input.callerUserId)
    ) {
      throw new MessageError(ErrorCodes.FORBIDDEN, 403, 'You are not a participant in this chat.');
    }
  }
  const limit = Math.min(
    input.limit ?? PAGINATION_CURSOR_DEFAULT_LIMIT,
    PAGINATION_CURSOR_MAX_LIMIT,
  );
  // Fetch head-sequence and the page in one transaction so the
  // response can't contain sequences newer than `headSequence` and so
  // a concurrent soft-delete of the chat surfaces as 404 instead of
  // leaking post-tombstone history.
  const snapshot = await loadActiveChatMessageSnapshot({
    chatId: input.chatId,
    authScope: buildReadScope(ctx, input.callerUserId),
    ...(input.beforeSequence !== undefined ? { beforeSequence: input.beforeSequence } : {}),
    ...(input.afterSequence !== undefined ? { afterSequence: input.afterSequence } : {}),
    limit,
  });
  if (snapshot === undefined) {
    // Chat was soft-deleted OR the caller's read access was revoked
    // (room membership ended) between the preflight check above and
    // the snapshot query. Both cases collapse to 404 so a concurrent
    // removal doesn't leak post-tombstone history.
    throw new MessageError(ErrorCodes.NOT_FOUND, 404, 'Chat not found.');
  }
  return {
    chatId: input.chatId,
    headSequence: snapshot.chat.currentSequence,
    messages: snapshot.messages.map(messageRowToPublic),
  };
}

export async function advanceReadState(input: {
  chatId: string;
  userId: string;
  readUpToSequence: number;
}): Promise<{ chatId: string; lastReadSequence: number }> {
  const ctx = await loadChatContext(input.chatId);
  if (ctx === undefined) {
    throw new MessageError(ErrorCodes.NOT_FOUND, 404, 'Chat not found.');
  }
  if (ctx.chat.type === 'room') {
    if ((await isActiveRoomMember(input.chatId, input.userId)) === undefined) {
      throw new MessageError(ErrorCodes.NOT_A_MEMBER, 403, 'You are not a member of this room.');
    }
  } else {
    if (ctx.directParticipantIds === null || !ctx.directParticipantIds.includes(input.userId)) {
      throw new MessageError(ErrorCodes.FORBIDDEN, 403, 'You are not a participant in this chat.');
    }
  }
  const row = await upsertReadState({
    chatId: input.chatId,
    userId: input.userId,
    readUpToSequence: input.readUpToSequence,
    authScope: buildReadScope(ctx, input.userId),
  });
  if (row === undefined) {
    // Either the chat was soft-deleted or the caller's room membership
    // was revoked between the preflight and the upsert. The INSERT ...
    // SELECT matched no row so no read-state was written. Treat it the
    // same as a cold 404 to avoid leaking distinctions a caller without
    // access couldn't observe anyway.
    throw new MessageError(ErrorCodes.NOT_FOUND, 404, 'Chat not found.');
  }
  // AC-UNREAD-04: fan out to the caller's other sessions so multi-tab
  // unread state converges. No broadcast to other users — read state is
  // a per-user fact.
  publishReadstateUpdated({
    chatId: input.chatId,
    userId: input.userId,
    lastReadSequence: row.lastReadSequence,
  });
  return { chatId: input.chatId, lastReadSequence: row.lastReadSequence };
}

export async function fetchReadState(input: { chatId: string; userId: string }): Promise<{
  chatId: string;
  lastReadSequence: number;
  headSequence: number;
  hasUnread: boolean;
}> {
  const ctx = await loadChatContext(input.chatId);
  if (ctx === undefined) {
    throw new MessageError(ErrorCodes.NOT_FOUND, 404, 'Chat not found.');
  }
  if (ctx.chat.type === 'room') {
    if ((await isActiveRoomMember(input.chatId, input.userId)) === undefined) {
      throw new MessageError(ErrorCodes.NOT_A_MEMBER, 403, 'You are not a member of this room.');
    }
  } else {
    if (ctx.directParticipantIds === null || !ctx.directParticipantIds.includes(input.userId)) {
      throw new MessageError(ErrorCodes.FORBIDDEN, 403, 'You are not a participant in this chat.');
    }
  }
  const state = await getReadState({
    chatId: input.chatId,
    userId: input.userId,
    authScope: buildReadScope(ctx, input.userId),
  });
  if (state === undefined) {
    // Same reasoning as `advanceReadState`: chat soft-deleted or
    // membership revoked collapses to a single 404 response.
    throw new MessageError(ErrorCodes.NOT_FOUND, 404, 'Chat not found.');
  }
  return {
    chatId: input.chatId,
    lastReadSequence: state.lastReadSequence,
    headSequence: state.headSequence,
    hasUnread: state.headSequence > state.lastReadSequence,
  };
}

export function messageRowToPublic(row: MessageRow): MessagePublic {
  return {
    id: row.id,
    chatId: row.chatId,
    sequence: row.sequence,
    authorUserId: row.authorUserId,
    kind: row.kind,
    bodyText: row.deletedAt === null ? (row.bodyText ?? null) : null,
    replyToMessageId: row.replyToMessageId ?? null,
    createdAt: row.createdAt.toISOString(),
    editedAt: row.editedAt?.toISOString() ?? null,
    deletedAt: row.deletedAt?.toISOString() ?? null,
  };
}

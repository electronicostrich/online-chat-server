import {
  ErrorCodes,
  MESSAGE_MAX_BYTES,
  PAGINATION_CURSOR_DEFAULT_LIMIT,
  PAGINATION_CURSOR_MAX_LIMIT,
  type MessagePublic,
} from 'shared-schemas';
import type { MessageRow } from '../../db/schema/messages.js';
import { MessageError } from './errors.js';
import {
  createDirectChatAndInsertMessage,
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
  await requireChatWriteAccess(input.chatId, input.senderUserId);
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
  const { message } = await insertMessageWithSequence({
    chatId: input.chatId,
    authorUserId: input.senderUserId,
    bodyText: body,
    replyToMessageId: input.replyToMessageId ?? null,
  });
  return message;
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

  const result = await createDirectChatAndInsertMessage({
    senderUserId: input.senderUserId,
    recipientUserId: input.recipientUserId,
    bodyText: body,
    replyToMessageId: input.replyToMessageId ?? null,
  });
  return {
    message: result.message,
    chatId: result.chat.id,
    chatCreated: result.chatCreated,
  };
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
  await requireChatWriteAccess(existing.chatId, input.authorUserId);
  const updated = await updateMessageBody({
    messageId: input.messageId,
    authorUserId: input.authorUserId,
    bodyText: body,
  });
  if (updated === undefined) {
    // Another caller deleted the message between the lookup and the
    // update. Surface the same 404 a cold caller would see.
    throw new MessageError(ErrorCodes.NOT_FOUND, 404, 'Message not found.');
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
    deletedByUserId: input.callerUserId,
  });
  if (deleted === undefined) {
    throw new MessageError(ErrorCodes.NOT_FOUND, 404, 'Message not found.');
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
    ...(input.beforeSequence !== undefined ? { beforeSequence: input.beforeSequence } : {}),
    ...(input.afterSequence !== undefined ? { afterSequence: input.afterSequence } : {}),
    limit,
  });
  if (snapshot === undefined) {
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
  });
  if (row === undefined) {
    // Chat was soft-deleted between the authz check above and the
    // upsert; the INSERT ... SELECT matched no active chat row so no
    // read-state was written. Treat it the same as a cold 404.
    throw new MessageError(ErrorCodes.NOT_FOUND, 404, 'Chat not found.');
  }
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
  });
  if (state === undefined) {
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

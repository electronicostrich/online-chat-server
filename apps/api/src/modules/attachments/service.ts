import {
  ATTACHMENT_MAX_FILE_BYTES,
  ATTACHMENT_MAX_IMAGE_BYTES,
  ErrorCodes,
  type AttachmentPublic,
} from 'shared-schemas';
import type { AttachmentRow } from '../../db/schema/attachments.js';
import type { MessageRow } from '../../db/schema/messages.js';
import {
  hasActiveBlockBetween,
  hasActiveFriendship,
  isActiveRoomMember as isActiveRoomMemberForMessage,
  loadChatContext,
} from '../messages/repository.js';
import { messageRowToPublic } from '../messages/service.js';
import { publishMessageCreated } from '../realtime/index.js';
import { AttachmentError } from './errors.js';
import {
  findAttachmentById,
  insertAttachmentWithMessage,
  isActiveRoomMember as isActiveRoomMemberForAttachment,
  loadChatForDownload,
  type UploadAuthScope,
} from './repository.js';
import { removeAttachmentBinary, writeAttachmentBinary } from './storage.js';
import { sanitizeStoredOriginalName } from './sanitize.js';

// AC-ATT-02: size limits split by media class. Any `image/*` MIME type
// uses the 3 MiB cap; everything else uses the 20 MiB cap. The route
// enforces both by configuring `@fastify/multipart` with the larger cap
// (so oversize files are refused at the transport layer without
// buffering gigabytes of data) and then re-checking the image-specific
// cap post-parse for files whose MIME type declares `image/*`.
export function limitForMimeType(mimeType: string | null): number {
  if (mimeType !== null && /^image\//iu.test(mimeType)) {
    return ATTACHMENT_MAX_IMAGE_BYTES;
  }
  return ATTACHMENT_MAX_FILE_BYTES;
}

export interface UploadInput {
  chatId: string;
  uploaderUserId: string;
  originalFilename: string;
  mimeType: string | null;
  buffer: Buffer;
  commentText: string | null;
  truncated: boolean;
}

export async function uploadAttachment(input: UploadInput): Promise<{
  attachment: AttachmentRow;
  message: MessageRow;
}> {
  // `truncated` fires when the multipart stream hit the transport-level
  // byte cap. Treat it the same as a post-parse oversize check so the
  // error response matches AC-ATT-02 regardless of which gate tripped.
  if (input.truncated) {
    throw new AttachmentError(
      ErrorCodes.PAYLOAD_TOO_LARGE,
      413,
      'Attachment exceeds the maximum allowed size.',
      { field: 'file', maxBytes: ATTACHMENT_MAX_FILE_BYTES },
    );
  }
  const size = input.buffer.byteLength;
  const limit = limitForMimeType(input.mimeType);
  if (size > limit) {
    throw new AttachmentError(
      ErrorCodes.PAYLOAD_TOO_LARGE,
      413,
      'Attachment exceeds the maximum allowed size.',
      { field: 'file', maxBytes: limit, actualBytes: size },
    );
  }

  const ctx = await loadChatContext(input.chatId);
  if (ctx === undefined) {
    throw new AttachmentError(ErrorCodes.NOT_FOUND, 404, 'Chat not found.');
  }

  let authScope: UploadAuthScope;
  if (ctx.chat.type === 'room') {
    const membership = await isActiveRoomMemberForMessage(input.chatId, input.uploaderUserId);
    if (membership === undefined) {
      throw new AttachmentError(
        ErrorCodes.NOT_A_MEMBER,
        403,
        'You are not a member of this room.',
      );
    }
    authScope = { kind: 'room', userId: input.uploaderUserId };
  } else {
    const otherUserId = ctx.directParticipantIds?.find((id) => id !== input.uploaderUserId);
    if (
      ctx.directParticipantIds === null ||
      !ctx.directParticipantIds.includes(input.uploaderUserId) ||
      otherUserId === undefined
    ) {
      throw new AttachmentError(
        ErrorCodes.FORBIDDEN,
        403,
        'You are not a participant in this chat.',
      );
    }
    if (await hasActiveBlockBetween(input.uploaderUserId, otherUserId)) {
      throw new AttachmentError(
        ErrorCodes.DM_NOT_ALLOWED,
        403,
        'Direct messages are not allowed between these users.',
      );
    }
    if (!(await hasActiveFriendship(input.uploaderUserId, otherUserId))) {
      throw new AttachmentError(
        ErrorCodes.DM_NOT_ALLOWED,
        403,
        'Direct messages require an active friendship.',
      );
    }
    authScope = { kind: 'direct', userId: input.uploaderUserId, otherUserId };
  }

  const storedOriginalFilename = sanitizeStoredOriginalName(input.originalFilename);
  const commentText = normaliseComment(input.commentText);

  // Generate the attachment id up front so the on-disk filename and
  // the DB row's primary key can share it. The file is written before
  // the INSERT so a failure in the DB leg doesn't leave the response
  // claiming a download that has no backing bytes. On the reverse
  // failure (binary write succeeded, INSERT lost a race), the catch
  // block below removes the orphan file.
  const attachmentId = crypto.randomUUID();
  const storagePath = await writeAttachmentBinary({
    chatId: input.chatId,
    attachmentId,
    buffer: input.buffer,
  });

  try {
    const result = await insertAttachmentWithMessage({
      attachmentId,
      chatId: input.chatId,
      uploaderUserId: input.uploaderUserId,
      originalFilename: storedOriginalFilename,
      storagePath,
      mimeType: input.mimeType,
      sizeBytes: size,
      commentText,
      authScope,
    });
    if (result === undefined) {
      // Lost race with a revocation (left room, DM frozen, chat
      // soft-deleted) between the preflight and the atomic insert.
      // Clean the orphan file before reporting, so disk usage doesn't
      // accumulate for rejected uploads.
      await removeAttachmentBinary(storagePath);
      throw new AttachmentError(
        ErrorCodes.FORBIDDEN,
        403,
        'Lost upload access to this chat before the attachment could be saved.',
      );
    }

    await publishMessageCreated({
      chatId: input.chatId,
      headSequence: result.nextSequence,
      message: messageRowToPublic(result.message),
    });
    return { attachment: result.attachment, message: result.message };
  } catch (err) {
    await removeAttachmentBinary(storagePath).catch(() => undefined);
    throw err;
  }
}

function normaliseComment(raw: string | null): string | null {
  if (raw === null) return null;
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;
  return trimmed;
}

export interface DownloadableAttachment {
  row: AttachmentRow;
}

// AC-ATT-03: download authorization is evaluated against the current
// state of the chat, not the uploader's historical role. An
// ex-member, a banned user, or a DM participant whose direct chat has
// been frozen/deleted all see the same 404 that a cold caller sees.
// Deleted attachments (`deletedAt !== null`) and deleted parent chats
// also return 404 so AC-ATT-04 cleanup is observable immediately.
export async function authorizeDownload(input: {
  attachmentId: string;
  callerUserId: string;
}): Promise<DownloadableAttachment> {
  const row = await findAttachmentById(input.attachmentId);
  if (row === undefined || row.deletedAt !== null) {
    throw new AttachmentError(ErrorCodes.NOT_FOUND, 404, 'Attachment not found.');
  }
  const chat = await loadChatForDownload(row.chatId);
  if (chat === undefined) {
    // Chat soft-deleted (AC-ATT-04). Collapse to 404 so an ex-member
    // can't distinguish "deleted" from "no longer authorized".
    throw new AttachmentError(ErrorCodes.NOT_FOUND, 404, 'Attachment not found.');
  }
  if (chat.type === 'room') {
    const stillMember = await isActiveRoomMemberForAttachment(row.chatId, input.callerUserId);
    if (!stillMember) {
      throw new AttachmentError(ErrorCodes.NOT_FOUND, 404, 'Attachment not found.');
    }
  } else {
    if (
      chat.directParticipantIds === null ||
      !chat.directParticipantIds.includes(input.callerUserId)
    ) {
      throw new AttachmentError(ErrorCodes.NOT_FOUND, 404, 'Attachment not found.');
    }
  }
  return { row };
}

export function attachmentRowToPublic(row: AttachmentRow): AttachmentPublic {
  return {
    id: row.id,
    chatId: row.chatId,
    messageId: row.messageId,
    originalFilename: row.originalFilename,
    sizeBytes: row.sizeBytes,
    mimeType: row.mimeType ?? null,
    commentText: row.commentText ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

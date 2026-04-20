import type {
  SyncRequestChatEntry,
  SyncResponseChatEntry,
} from 'shared-schemas';
import {
  getReadState,
  isActiveRoomMember,
  loadChatContext,
  type ReadAuthScope,
} from '../messages/repository.js';

// AC-RT-02 / AC-RT-04. Compute the per-chat advice the client needs to
// reconcile its local sequence watermark with authoritative state. The
// caller (realtime gateway) has already validated that the websocket
// belongs to `userId`; we re-run the membership / participant check per
// chat because a subscription or cached chat id could outlive
// membership loss (ban, removal, chat deletion).
export async function computeSyncAdviceForChat(
  userId: string,
  entry: SyncRequestChatEntry,
): Promise<SyncResponseChatEntry> {
  const ctx = await loadChatContext(entry.chatId);
  if (ctx === undefined) {
    return {
      chatId: entry.chatId,
      headSequence: 0,
      serverReadSequence: 0,
      advice: 'chat-inaccessible',
    };
  }
  let authScope: ReadAuthScope;
  if (ctx.chat.type === 'room') {
    const membership = await isActiveRoomMember(entry.chatId, userId);
    if (membership === undefined) {
      return {
        chatId: entry.chatId,
        headSequence: 0,
        serverReadSequence: 0,
        advice: 'chat-inaccessible',
      };
    }
    authScope = { kind: 'room', userId };
  } else {
    if (
      ctx.directParticipantIds === null ||
      !ctx.directParticipantIds.includes(userId)
    ) {
      return {
        chatId: entry.chatId,
        headSequence: 0,
        serverReadSequence: 0,
        advice: 'chat-inaccessible',
      };
    }
    authScope = { kind: 'direct', userId };
  }

  const state = await getReadState({
    chatId: entry.chatId,
    userId,
    authScope,
  });
  // Access just verified, so the chat row is there — but a concurrent
  // delete/ban between the context load and the read-state query is
  // possible. Treat the miss the same as lost access.
  if (state === undefined) {
    return {
      chatId: entry.chatId,
      headSequence: 0,
      serverReadSequence: 0,
      advice: 'chat-inaccessible',
    };
  }

  const headSequence = state.headSequence;
  const serverReadSequence = state.lastReadSequence;

  if (entry.lastKnownContiguousSequence >= headSequence) {
    return {
      chatId: entry.chatId,
      headSequence,
      serverReadSequence,
      advice: 'in-sync',
    };
  }
  return {
    chatId: entry.chatId,
    headSequence,
    serverReadSequence,
    advice: 'fetch-history',
    rangeHint: {
      fromSequence: entry.lastKnownContiguousSequence + 1,
      toSequence: headSequence,
    },
  };
}

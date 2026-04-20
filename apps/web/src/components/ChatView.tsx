import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { AttachmentPublic, MessagePublic } from 'shared-schemas';
import { useSession } from '../auth/SessionContext.js';
import {
  advanceReadState,
  editMessage,
  listChatMessages,
  sendChatMessage,
} from '../api/messages.js';
import { uploadAttachment } from '../api/attachments.js';
import type { RealtimeClient, RealtimeSyncAdvice } from '../realtime/client.js';
import { Composer } from './Composer.js';
import { MessageList } from './MessageList.js';

interface ChatViewProps {
  chatId: string;
  realtime: RealtimeClient;
}

interface MessagesQueryData {
  chatId: string;
  headSequence: number;
  messages: MessagePublic[];
}

function dedupeAndSort(messages: MessagePublic[]): MessagePublic[] {
  // Server returns newest-first; the UI renders oldest-at-top, newest-at-
  // bottom. Deduplicate by sequence so an optimistic insert, the websocket
  // echo, and a gap-repair backfill for the same row cannot render twice
  // (AC-RT-05: duplicate or out-of-order events do not produce duplicates).
  const bySequence = new Map<number, MessagePublic>();
  for (const m of messages) bySequence.set(m.sequence, m);
  return [...bySequence.values()].sort((a, b) => a.sequence - b.sequence);
}

// Walk the cached set of sequences forward from `anchor` and return the
// highest sequence such that every value in `anchor+1..N` is present. Used
// both as the `lastKnownContiguousSequence` the client hands the server in
// sync.request (so the server can tell us whether we missed anything) and
// to track how far forward live WS messages have advanced us.
function contiguousTipFrom(anchor: number, messages: MessagePublic[]): number {
  const sequences = new Set<number>();
  for (const m of messages) sequences.add(m.sequence);
  let tip = anchor;
  while (sequences.has(tip + 1)) tip += 1;
  return tip;
}

export function ChatView({ chatId, realtime }: ChatViewProps): ReactElement {
  const queryClient = useQueryClient();
  const { user } = useSession();
  // Memoise the query key so the realtime-subscribe effect's deps array stays
  // referentially stable across renders — without this every render would
  // unsubscribe + re-subscribe on the websocket.
  const queryKey = useMemo(() => ['chat', chatId, 'messages'] as const, [chatId]);

  // AC-RT-02 / AC-RT-04 — per-chat sync state. `lastKnownContiguousRef`
  // tracks the highest sequence whose entire prefix the client has
  // received; it is what we hand the server in sync.request. It advances
  // when a live WS `message.created` arrives at exactly tip+1, or when a
  // backfill closes a gap. A live event at tip+2+ leaves the ref at tip,
  // which is what makes the next sync.request detect the gap.
  const lastKnownContiguousRef = useRef(0);
  const lastKnownReadRef = useRef(0);
  const [accessRevoked, setAccessRevoked] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey,
    queryFn: async (): Promise<MessagesQueryData> => {
      const fetched = await listChatMessages(chatId, { limit: 50 });
      const fetchedData: MessagesQueryData = {
        chatId: fetched.chatId,
        headSequence: fetched.headSequence,
        messages: dedupeAndSort(fetched.messages),
      };
      // If the realtime client delivered a `message.created` event into the
      // cache between mount and this fetch resolving, those messages would be
      // overwritten by the bare REST snapshot. Merge against any existing
      // cache value so cached-newer rows survive.
      const existing = queryClient.getQueryData<MessagesQueryData>(queryKey);
      if (existing === undefined) return fetchedData;
      return {
        chatId: fetchedData.chatId,
        headSequence: Math.max(existing.headSequence, fetchedData.headSequence),
        messages: dedupeAndSort([...existing.messages, ...fetchedData.messages]),
      };
    },
    enabled: !accessRevoked,
  });

  // AC-UNREAD-03 — UI surface: advance the caller's read watermark to the
  // current head on open-of-chat, after each own-send, and whenever the
  // user actually catches up to the bottom of the list. The server clamps
  // monotonically (GREATEST(existing, LEAST(requested, head))) so a racing
  // over-advance is harmless; the ref just dedupes identical advances so
  // unrelated re-renders don't spam the endpoint. Realtime arrivals that
  // leave the user scrolled-up deliberately do NOT auto-advance — the
  // catch-up advance only fires once `MessageList` reports the user is at
  // (or has returned to) the bottom, matching the readstate freshness
  // rules in `docs/api-and-events.md` §11.
  const lastAdvancedRef = useRef<{ chatId: string; sequence: number } | null>(null);
  const pendingAdvanceRef = useRef<{ chatId: string; sequence: number } | null>(null);
  const advanceIfNeeded = useCallback(
    (targetSequence: number): void => {
      if (targetSequence < 0) return;
      const alreadyAdvanced =
        lastAdvancedRef.current?.chatId === chatId &&
        lastAdvancedRef.current.sequence >= targetSequence;
      if (alreadyAdvanced) return;
      // Refuse to overlap an already in-flight advance for the same target;
      // the success or failure handler below will issue the next one.
      if (
        pendingAdvanceRef.current?.chatId === chatId &&
        pendingAdvanceRef.current.sequence >= targetSequence
      ) {
        return;
      }
      pendingAdvanceRef.current = { chatId, sequence: targetSequence };
      advanceReadState(chatId, targetSequence)
        .then(() => {
          // Mark the advance as applied only after the server ACKs it; a
          // transient failure must not permanently suppress retries.
          lastAdvancedRef.current = { chatId, sequence: targetSequence };
          lastKnownReadRef.current = Math.max(
            lastKnownReadRef.current,
            targetSequence,
          );
        })
        .catch(() => {
          // Failure leaves the watermark where it was on the server. Clear
          // the pending ref so the next opportunity retries.
        })
        .finally(() => {
          if (
            pendingAdvanceRef.current?.chatId === chatId &&
            pendingAdvanceRef.current.sequence === targetSequence
          ) {
            pendingAdvanceRef.current = null;
          }
        });
    },
    [chatId],
  );

  const sendMutation = useMutation({
    mutationFn: (bodyText: string) => sendChatMessage(chatId, { bodyText }),
    onSuccess: ({ message }) => {
      queryClient.setQueryData<MessagesQueryData>(queryKey, (prev) => {
        if (prev === undefined) {
          return {
            chatId,
            headSequence: message.sequence,
            messages: [message],
          };
        }
        return {
          chatId: prev.chatId,
          headSequence: Math.max(prev.headSequence, message.sequence),
          messages: dedupeAndSort([...prev.messages, message]),
        };
      });
      advanceIfNeeded(message.sequence);
    },
  });

  // AC-ATT-01 UI surface: stash attachment metadata keyed by messageId so
  // `MessageList` can render a rich attachment card (filename + size +
  // download link) alongside the sibling `kind='attachment'` message row.
  // The map only covers attachments uploaded within this session — the
  // `GET /chats/{id}/messages` contract today does not embed attachment
  // metadata on history rows, so a page reload renders history attachments
  // as a generic "[Attachment]" placeholder. Wiring history attachments
  // waits on a WS-06 surface (`GET /chats/{id}/attachments` or
  // equivalent) that isn't part of this workstream's scope.
  const [attachmentsByMessageId, setAttachmentsByMessageId] = useState<
    Record<string, AttachmentPublic>
  >({});

  const uploadMutation = useMutation({
    mutationFn: ({ file, commentText }: { file: File; commentText: string | null }) =>
      uploadAttachment({ chatId, file, commentText }),
    onSuccess: ({ attachment, message }) => {
      setAttachmentsByMessageId((prev) => ({ ...prev, [message.id]: attachment }));
      queryClient.setQueryData<MessagesQueryData>(queryKey, (prev) => {
        if (prev === undefined) {
          return {
            chatId,
            headSequence: message.sequence,
            messages: [message],
          };
        }
        return {
          chatId: prev.chatId,
          headSequence: Math.max(prev.headSequence, message.sequence),
          messages: dedupeAndSort([...prev.messages, message]),
        };
      });
      advanceIfNeeded(message.sequence);
    },
  });

  const editMutation = useMutation({
    mutationFn: ({ messageId, bodyText }: { messageId: string; bodyText: string }) =>
      editMessage(messageId, { bodyText }),
    onSuccess: ({ message }) => {
      // Replace the row in the cache so the editor closes against the new
      // body even if the websocket echo hasn't arrived yet. The realtime
      // `message.edited` listener below is idempotent (same sequence + same
      // payload), so a duplicate update is a no-op.
      queryClient.setQueryData<MessagesQueryData>(queryKey, (prev) => {
        if (prev === undefined) return prev;
        const next = prev.messages.map((m) =>
          m.id === message.id ? message : m,
        );
        return { ...prev, messages: next };
      });
    },
  });

  // AC-RT-04 — backfill the gap the server reported in `rangeHint`. Uses
  // `afterSequence = fromSequence - 1` and loops (page size is server-capped
  // at 100) until we have the full range in the cache. After merge, the
  // contiguous-tip ref is re-walked from its old value to absorb the newly
  // filled rows; a subsequent WS message at tip+1 will then cleanly advance.
  const backfillRange = useCallback(
    async (fromSequence: number, toSequence: number): Promise<void> => {
      let cursor = fromSequence - 1;
      const PAGE = 100;
      // Safety cap — a gap of tens of thousands would indicate a bug or a
      // long-absent tab; bail out of the loop rather than hammer the API.
      for (let iterations = 0; iterations < 100; iterations += 1) {
        const page = await listChatMessages(chatId, {
          afterSequence: cursor,
          limit: PAGE,
        });
        if (page.messages.length === 0) break;
        const highestInPage = page.messages.reduce(
          (acc, m) => (m.sequence > acc ? m.sequence : acc),
          cursor,
        );
        queryClient.setQueryData<MessagesQueryData>(queryKey, (prev) => {
          if (prev === undefined) {
            return {
              chatId: page.chatId,
              headSequence: page.headSequence,
              messages: dedupeAndSort(page.messages),
            };
          }
          return {
            chatId: prev.chatId,
            headSequence: Math.max(prev.headSequence, page.headSequence),
            messages: dedupeAndSort([...prev.messages, ...page.messages]),
          };
        });
        if (highestInPage >= toSequence) break;
        if (highestInPage === cursor) break; // no forward progress
        cursor = highestInPage;
      }
      // Re-walk the contiguous tip against the new cache contents so the
      // next sync.request (and the live message.created handler) see the
      // gap as closed.
      const latest = queryClient.getQueryData<MessagesQueryData>(queryKey);
      if (latest !== undefined) {
        lastKnownContiguousRef.current = contiguousTipFrom(
          lastKnownContiguousRef.current,
          latest.messages,
        );
      }
    },
    [chatId, queryClient, queryKey],
  );

  const handleSyncAdvice = useCallback(
    (advice: RealtimeSyncAdvice): void => {
      if (advice.advice === 'chat-inaccessible') {
        // Lost access (banned, removed, or the chat was deleted). Drop local
        // cache so we don't keep rendering stale rows, and render a
        // placeholder instead of the chat view.
        queryClient.removeQueries({ queryKey });
        setAccessRevoked(true);
        return;
      }
      lastKnownReadRef.current = Math.max(
        lastKnownReadRef.current,
        advice.serverReadSequence,
      );
      if (advice.advice === 'in-sync') {
        lastKnownContiguousRef.current = Math.max(
          lastKnownContiguousRef.current,
          advice.headSequence,
        );
        return;
      }
      // advice.advice === 'fetch-history' — backfill only fires when the
      // server supplied a rangeHint (it always should for this branch, but
      // the optional marker in the schema means we guard explicitly).
      if (advice.rangeHint !== undefined) {
        void backfillRange(advice.rangeHint.fromSequence, advice.rangeHint.toSequence);
      }
    },
    [backfillRange, queryClient, queryKey],
  );

  const getSyncState = useCallback(
    () => ({
      lastKnownContiguousSequence: lastKnownContiguousRef.current,
      lastKnownReadSequence: lastKnownReadRef.current,
    }),
    [],
  );

  useEffect(() => {
    const unsubscribe = realtime.subscribeToChat(chatId, {
      onEvent: (event) => {
        if (event.type === 'message.created') {
          const incoming = event.payload.message;
          if (incoming.sequence === lastKnownContiguousRef.current + 1) {
            lastKnownContiguousRef.current = incoming.sequence;
          }
          // Messages with sequence > tip+1 indicate a gap; leave the ref
          // as-is so the next sync.request detects and repairs it. The
          // row is still surfaced to the user (rendered in order by
          // dedupeAndSort) so the chat stays live in the meantime.
          queryClient.setQueryData<MessagesQueryData>(queryKey, (prev) => {
            if (prev === undefined) {
              return {
                chatId: incoming.chatId,
                headSequence: incoming.sequence,
                messages: [incoming],
              };
            }
            return {
              chatId: prev.chatId,
              headSequence: Math.max(prev.headSequence, incoming.sequence),
              messages: dedupeAndSort([...prev.messages, incoming]),
            };
          });
        } else if (event.type === 'message.deleted') {
          queryClient.setQueryData<MessagesQueryData>(queryKey, (prev) => {
            if (prev === undefined) return prev;
            const next = prev.messages.map((m) =>
              m.sequence === event.payload.sequence
                ? { ...m, deletedAt: event.payload.deletedAt, bodyText: null }
                : m,
            );
            return { ...prev, messages: next };
          });
        } else {
          queryClient.setQueryData<MessagesQueryData>(queryKey, (prev) => {
            if (prev === undefined) return prev;
            const next = prev.messages.map((m) =>
              m.sequence === event.payload.sequence
                ? { ...m, bodyText: event.payload.bodyText, editedAt: event.payload.editedAt }
                : m,
            );
            return { ...prev, messages: next };
          });
        }
      },
      onSyncAdvice: handleSyncAdvice,
      getSyncState,
    });
    return unsubscribe;
  }, [chatId, getSyncState, handleSyncAdvice, queryClient, queryKey, realtime]);

  const messages = data?.messages ?? [];

  // Open-of-chat advance: once the initial history fetch resolves, mark the
  // caller's watermark at the fetched head. The `advanceIfNeeded` dedupe is
  // keyed on the resolved head sequence (not on "has this chatId been
  // processed"), so a transient failure doesn't permanently suppress
  // retries: the effect re-runs on every relevant render, and
  // `advanceIfNeeded` only becomes a no-op *after* the server has ACKed
  // the target sequence.
  useEffect(() => {
    if (data === undefined) return;
    // Seed the sync-state refs from the authoritative fetch: at this
    // moment the cache matches the server's head, so the client is
    // contiguous up to head.
    lastKnownContiguousRef.current = Math.max(
      lastKnownContiguousRef.current,
      data.headSequence,
    );
    advanceIfNeeded(data.headSequence);
  }, [advanceIfNeeded, data]);

  // Memoised so MessageList's scroll-listener effect doesn't tear down +
  // re-attach on every ChatView render.
  const handleCatchUp = useCallback(
    (sequence: number) => {
      advanceIfNeeded(sequence);
    },
    [advanceIfNeeded],
  );
  const handleEdit = useCallback(
    async (messageId: string, bodyText: string) => {
      await editMutation.mutateAsync({ messageId, bodyText });
    },
    [editMutation],
  );

  if (accessRevoked) {
    return (
      <section className="chat-view" data-testid="chat-view" data-chat-id={chatId}>
        <header className="chat-view-header">
          <h2>Chat unavailable</h2>
        </header>
        <p data-testid="chat-inaccessible">
          You no longer have access to this chat.
        </p>
      </section>
    );
  }

  return (
    <section className="chat-view" data-testid="chat-view" data-chat-id={chatId}>
      <header className="chat-view-header">
        <h2>Chat</h2>
      </header>
      {isLoading ? (
        <p data-testid="chat-loading">Loading messages…</p>
      ) : (
        <MessageList
          messages={messages}
          attachmentsByMessageId={attachmentsByMessageId}
          currentUserId={user?.id ?? null}
          onEdit={handleEdit}
          onCatchUp={handleCatchUp}
        />
      )}
      <Composer
        disabled={sendMutation.isPending || uploadMutation.isPending}
        onSend={async (bodyText) => {
          await sendMutation.mutateAsync(bodyText);
        }}
        onAttach={async (file, commentText) => {
          await uploadMutation.mutateAsync({ file, commentText });
        }}
      />
    </section>
  );
}

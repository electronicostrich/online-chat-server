import { useCallback, useEffect, useMemo, useRef, type ReactElement } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { MessagePublic } from 'shared-schemas';
import { useSession } from '../auth/SessionContext.js';
import {
  advanceReadState,
  editMessage,
  listChatMessages,
  sendChatMessage,
} from '../api/messages.js';
import type { RealtimeClient } from '../realtime/client.js';
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
  // bottom. Deduplicate by sequence so an optimistic insert and the websocket
  // echo don't render twice.
  const bySequence = new Map<number, MessagePublic>();
  for (const m of messages) bySequence.set(m.sequence, m);
  return [...bySequence.values()].sort((a, b) => a.sequence - b.sequence);
}

export function ChatView({ chatId, realtime }: ChatViewProps): ReactElement {
  const queryClient = useQueryClient();
  const { user } = useSession();
  // Memoise the query key so the realtime-subscribe effect's deps array stays
  // referentially stable across renders — without this every render would
  // unsubscribe + re-subscribe on the websocket.
  const queryKey = useMemo(() => ['chat', chatId, 'messages'] as const, [chatId]);

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

  useEffect(() => {
    const unsubscribe = realtime.subscribeToChat(chatId, (event) => {
      if (event.type === 'message.created') {
        const incoming = event.payload.message;
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
    });
    return unsubscribe;
  }, [chatId, queryClient, queryKey, realtime]);

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
          currentUserId={user?.id ?? null}
          onEdit={handleEdit}
          onCatchUp={handleCatchUp}
        />
      )}
      <Composer
        disabled={sendMutation.isPending}
        onSend={async (bodyText) => {
          await sendMutation.mutateAsync(bodyText);
        }}
      />
    </section>
  );
}

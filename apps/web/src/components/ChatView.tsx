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
  // current head on open-of-chat and after each own-send. The server clamps
  // monotonically (GREATEST(existing, LEAST(requested, head))) so a racing
  // over-advance is harmless; the ref just dedupes identical advances so
  // unrelated re-renders don't spam the endpoint. We deliberately do NOT
  // advance on realtime-delivered messages — if the user has scrolled up to
  // read older history, auto-advancing would clear unread state for rows
  // they haven't actually read. That matches the "clear-on-open" contract
  // and the readstate freshness rules in `docs/api-and-events.md` §11.
  const lastAdvancedRef = useRef<{ chatId: string; sequence: number } | null>(null);
  const advanceIfNeeded = useCallback(
    (targetSequence: number): void => {
      if (targetSequence < 0) return;
      const alreadyAdvanced =
        lastAdvancedRef.current?.chatId === chatId &&
        lastAdvancedRef.current.sequence >= targetSequence;
      if (alreadyAdvanced) return;
      lastAdvancedRef.current = { chatId, sequence: targetSequence };
      advanceReadState(chatId, targetSequence).catch(() => {
        // Failure just means the watermark stays where it was on the server.
        // Reset the ref so the next opportunity retries.
        lastAdvancedRef.current = null;
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
  // caller's watermark at the fetched head. Only the *first* fetch for a
  // given chatId triggers this — subsequent re-fetches (window-focus,
  // invalidation) don't, because mid-session the cache already reflects
  // everything the user has had on-screen and a later implicit advance
  // would reintroduce the "cleared unread too early" drift we're trying to
  // avoid.
  const initialHeadAppliedRef = useRef<string | null>(null);
  useEffect(() => {
    if (data === undefined) return;
    if (initialHeadAppliedRef.current === chatId) return;
    initialHeadAppliedRef.current = chatId;
    advanceIfNeeded(data.headSequence);
  }, [advanceIfNeeded, chatId, data]);

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
          onEdit={async (messageId, bodyText) => {
            await editMutation.mutateAsync({ messageId, bodyText });
          }}
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

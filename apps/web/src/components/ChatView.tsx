import { useEffect, useState, type ReactElement } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { MessagePublic } from 'shared-schemas';
import { listChatMessages, sendChatMessage } from '../api/messages.js';
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
  // bottom. We also de-duplicate by sequence in case an optimistic insert
  // and the websocket echo race.
  const bySequence = new Map<number, MessagePublic>();
  for (const m of messages) bySequence.set(m.sequence, m);
  return [...bySequence.values()].sort((a, b) => a.sequence - b.sequence);
}

export function ChatView({ chatId, realtime }: ChatViewProps): ReactElement {
  const queryClient = useQueryClient();
  const queryKey = ['chat', chatId, 'messages'] as const;

  const { data, isLoading } = useQuery({
    queryKey,
    queryFn: async (): Promise<MessagesQueryData> => {
      const fetched = await listChatMessages(chatId, { limit: 50 });
      return {
        chatId: fetched.chatId,
        headSequence: fetched.headSequence,
        messages: dedupeAndSort(fetched.messages),
      };
    },
  });

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
    },
  });

  const [, setLiveTick] = useState(0);

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
      setLiveTick((tick) => tick + 1);
    });
    return unsubscribe;
  }, [chatId, queryClient, queryKey, realtime]);

  const messages = data?.messages ?? [];

  return (
    <section className="chat-view" data-testid="chat-view" data-chat-id={chatId}>
      <header className="chat-view-header">
        <h2>Chat</h2>
      </header>
      {isLoading ? (
        <p data-testid="chat-loading">Loading messages…</p>
      ) : (
        <MessageList messages={messages} />
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

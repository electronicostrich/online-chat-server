import type {
  MessageCreatedEvent,
  MessageDeletedEvent,
  MessageEditedEvent,
  ReadstateUpdatedEvent,
  SessionRevokedEvent,
  SyncResponseEvent,
} from 'shared-schemas';

export type OutboundEvent =
  | MessageCreatedEvent
  | MessageEditedEvent
  | MessageDeletedEvent
  | ReadstateUpdatedEvent
  | SessionRevokedEvent
  | SyncResponseEvent;

// Narrow slice of the `ws` WebSocket surface that the realtime module
// actually uses. Declared structurally so that unit tests can supply a
// fake without dragging in the full `WebSocket` type.
export interface DeliverableSocket {
  readyState: number;
  bufferedAmount: number;
  send: (payload: string) => void;
  close: (code?: number, reason?: string) => void;
}

export interface SocketContext {
  sessionId: string;
  userId: string;
  socket: DeliverableSocket;
  // Chats the client has subscribed to via `chat.subscribe`. The gateway
  // re-checks authorization on each message before delivery so a stale
  // subscription (member removed, chat deleted) never leaks data.
  subscriptions: Set<string>;
}

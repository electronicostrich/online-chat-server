import type { WebSocket } from '@fastify/websocket';
import type {
  MessageCreatedEvent,
  MessageDeletedEvent,
  MessageEditedEvent,
  ReadstateUpdatedEvent,
  SessionRevokedEvent,
} from 'shared-schemas';

export type OutboundEvent =
  | MessageCreatedEvent
  | MessageEditedEvent
  | MessageDeletedEvent
  | ReadstateUpdatedEvent
  | SessionRevokedEvent;

export interface SocketContext {
  sessionId: string;
  userId: string;
  socket: WebSocket;
  // Chats the client has subscribed to via `chat.subscribe`. The gateway
  // re-checks authorization on each message before delivery so a stale
  // subscription (member removed, chat deleted) never leaks data.
  subscriptions: Set<string>;
}

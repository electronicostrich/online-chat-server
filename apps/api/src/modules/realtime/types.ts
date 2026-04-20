import type {
  MessageCreatedEvent,
  MessageDeletedEvent,
  MessageEditedEvent,
  PresenceUpdatedEvent,
  ReadstateUpdatedEvent,
  SessionRevokedEvent,
  SyncResponseEvent,
} from 'shared-schemas';

export type OutboundEvent =
  | MessageCreatedEvent
  | MessageEditedEvent
  | MessageDeletedEvent
  | PresenceUpdatedEvent
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
  // AC-PRES-01..04. `lastHeartbeatAt` is bumped by any command from
  // this tab (connect, heartbeat, activity, subscribe, ...) — anything
  // that proves the tab is still running JS. `lastActivityAt` is only
  // bumped by `presence.activity`, so idle-but-connected tabs fall
  // to AFK while hibernated tabs fall further to offline.
  lastHeartbeatAt: number;
  lastActivityAt: number;
}

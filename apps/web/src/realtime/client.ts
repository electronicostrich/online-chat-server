// Thin reconnecting wrapper around the native `WebSocket`. Per ADR-009 §54
// the SPA owns this layer (no socket.io / pusher); the API gateway speaks
// the envelope documented in api-and-events.md §6.3 / §6.4.
//
// Responsibilities:
// - open one socket per session,
// - send `chat.subscribe` / `chat.unsubscribe` commands when chat views mount
//   and unmount,
// - dispatch incoming events to per-chat listeners.
//
// Reconnect loop is intentionally simple: on any close, retry with bounded
// exponential backoff capped at 10s. The chat view's effect re-issues
// `chat.subscribe` whenever the socket transitions to OPEN, so the server's
// per-connection subscription set is rebuilt after a drop.

import type {
  ChatSubscribeCommand,
  ChatUnsubscribeCommand,
  EventEnvelopeBase,
  MessageCreatedPayload,
  MessageDeletedPayload,
  MessageEditedPayload,
} from 'shared-schemas';

// Default uses the same origin as the page so the Vite dev server's
// `ws: true` proxy handles the upgrade. See `vite.config.ts`. Override with
// `VITE_WEBSOCKET_URL` for deploys where the SPA is hosted separately.
function defaultWebSocketUrl(): string {
  if (typeof window === 'undefined') return 'ws://localhost:3000/ws';
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${window.location.host}/ws`;
}

const WS_URL: string =
  (import.meta.env.VITE_WEBSOCKET_URL as string | undefined) ?? defaultWebSocketUrl();

export type ChatRealtimeEvent =
  | { type: 'message.created'; payload: MessageCreatedPayload }
  | { type: 'message.edited'; payload: MessageEditedPayload }
  | { type: 'message.deleted'; payload: MessageDeletedPayload };

type ChatListener = (event: ChatRealtimeEvent) => void;

export interface RealtimeClient {
  subscribeToChat: (chatId: string, listener: ChatListener) => () => void;
  close: () => void;
}

export function createRealtimeClient(): RealtimeClient {
  const listeners = new Map<string, Set<ChatListener>>();
  let socket: WebSocket | null = null;
  let reconnectAttempts = 0;
  let reconnectTimer: number | null = null;
  let closed = false;

  function nextCommandId(): string {
    return `cmd-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  }

  function send(command: ChatSubscribeCommand | ChatUnsubscribeCommand): void {
    if (socket !== null && socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify(command));
    }
  }

  function openSocket(): void {
    if (closed) return;
    const ws = new WebSocket(WS_URL);
    socket = ws;
    ws.addEventListener('open', () => {
      reconnectAttempts = 0;
      // Re-subscribe to every chat that has at least one listener — covers
      // both the first connect and any reconnect after a drop.
      for (const chatId of listeners.keys()) {
        send({ id: nextCommandId(), type: 'chat.subscribe', payload: { chatId } });
      }
    });
    ws.addEventListener('message', (event: MessageEvent<unknown>) => {
      if (typeof event.data !== 'string') return;
      let parsed: EventEnvelopeBase;
      try {
        parsed = JSON.parse(event.data) as EventEnvelopeBase;
      } catch {
        return;
      }
      dispatch(parsed);
    });
    ws.addEventListener('close', () => {
      socket = null;
      if (closed) return;
      const delay = Math.min(10_000, 250 * 2 ** reconnectAttempts);
      reconnectAttempts += 1;
      reconnectTimer = window.setTimeout(() => {
        reconnectTimer = null;
        openSocket();
      }, delay);
    });
  }

  function dispatch(envelope: EventEnvelopeBase): void {
    if (envelope.type !== 'message.created' &&
        envelope.type !== 'message.edited' &&
        envelope.type !== 'message.deleted') {
      return;
    }
    const payload = envelope.payload as { chatId?: unknown };
    const chatId = typeof payload.chatId === 'string' ? payload.chatId : null;
    if (chatId === null) return;
    const subs = listeners.get(chatId);
    if (subs === undefined) return;
    const event: ChatRealtimeEvent =
      envelope.type === 'message.created'
        ? { type: 'message.created', payload: envelope.payload as MessageCreatedPayload }
        : envelope.type === 'message.edited'
          ? { type: 'message.edited', payload: envelope.payload as MessageEditedPayload }
          : { type: 'message.deleted', payload: envelope.payload as MessageDeletedPayload };
    for (const listener of subs) {
      listener(event);
    }
  }

  function subscribeToChat(chatId: string, listener: ChatListener): () => void {
    const existing = listeners.get(chatId) ?? new Set<ChatListener>();
    const wasEmpty = existing.size === 0;
    existing.add(listener);
    listeners.set(chatId, existing);
    if (wasEmpty) {
      send({ id: nextCommandId(), type: 'chat.subscribe', payload: { chatId } });
    }
    return () => {
      const set = listeners.get(chatId);
      if (set === undefined) return;
      set.delete(listener);
      if (set.size === 0) {
        listeners.delete(chatId);
        send({ id: nextCommandId(), type: 'chat.unsubscribe', payload: { chatId } });
      }
    };
  }

  function close(): void {
    closed = true;
    if (reconnectTimer !== null) {
      window.clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    if (socket !== null) {
      socket.close();
      socket = null;
    }
    listeners.clear();
  }

  openSocket();
  return { subscribeToChat, close };
}

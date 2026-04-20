// Thin reconnecting wrapper around the native `WebSocket`. Per ADR-009 §54
// the SPA owns this layer (no socket.io / pusher); the API gateway speaks
// the envelope documented in api-and-events.md §6.3 / §6.4.
//
// Responsibilities:
// - open one socket per session,
// - send `chat.subscribe` / `chat.unsubscribe` commands when chat views mount
//   and unmount,
// - send `sync.request` on (re)connect so the server can tell the client
//   whether each subscribed chat is in-sync, needs gap repair via HTTP
//   history, or is no longer accessible (AC-RT-02 / AC-RT-04),
// - dispatch incoming events to per-chat listeners.
//
// Reconnect loop is intentionally simple: on any close, retry with bounded
// exponential backoff capped at 10s. The sync.request on OPEN is what
// authoritatively reconciles per-chat state after a drop — callers that
// detect a local gap should still treat the stream as non-contiguous until
// the matching `sync.response` arrives, per api-and-events.md §6.2.

import type {
  ChatSubscribeCommand,
  ChatUnsubscribeCommand,
  EventEnvelopeBase,
  MessageCreatedPayload,
  MessageDeletedPayload,
  MessageEditedPayload,
  SyncAdvice,
  SyncRequestCommand,
  SyncResponseChatEntry,
  SyncResponsePayload,
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

export interface RealtimeSyncAdvice {
  headSequence: number;
  serverReadSequence: number;
  advice: SyncAdvice;
  rangeHint?: { fromSequence: number; toSequence: number };
}

export interface ChatSyncState {
  lastKnownContiguousSequence: number;
  lastKnownReadSequence: number;
}

export interface ChatSubscribeOptions {
  onEvent: (event: ChatRealtimeEvent) => void;
  onSyncAdvice?: (advice: RealtimeSyncAdvice) => void;
  getSyncState?: () => ChatSyncState;
}

interface ChatSubscription {
  onEvent: (event: ChatRealtimeEvent) => void;
  onSyncAdvice?: (advice: RealtimeSyncAdvice) => void;
  getSyncState?: () => ChatSyncState;
}

export interface RealtimeClient {
  subscribeToChat: (chatId: string, options: ChatSubscribeOptions) => () => void;
  close: () => void;
}

export function createRealtimeClient(): RealtimeClient {
  const subscriptions = new Map<string, ChatSubscription>();
  let socket: WebSocket | null = null;
  let reconnectAttempts = 0;
  let reconnectTimer: number | null = null;
  let closed = false;

  function nextCommandId(): string {
    return `cmd-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  }

  function send(
    command: ChatSubscribeCommand | ChatUnsubscribeCommand | SyncRequestCommand,
  ): void {
    if (socket !== null && socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify(command));
    }
  }

  function sendSyncRequestForAll(): void {
    if (subscriptions.size === 0) return;
    const chats: SyncRequestCommand['payload']['chats'] = [];
    for (const [chatId, sub] of subscriptions) {
      // `getSyncState` is optional so tests that don't care about gap
      // repair can omit it. Callers that want per-chat reconciliation
      // must provide it so the server knows where they think they are.
      const state = sub.getSyncState?.() ?? {
        lastKnownContiguousSequence: 0,
        lastKnownReadSequence: 0,
      };
      chats.push({
        chatId,
        lastKnownContiguousSequence: state.lastKnownContiguousSequence,
        lastKnownReadSequence: state.lastKnownReadSequence,
      });
    }
    send({
      id: nextCommandId(),
      type: 'sync.request',
      payload: { chats },
    });
  }

  function openSocket(): void {
    if (closed) return;
    const ws = new WebSocket(WS_URL);
    socket = ws;
    ws.addEventListener('open', () => {
      reconnectAttempts = 0;
      // Re-subscribe to every chat with at least one listener — covers
      // both the first connect and any reconnect after a drop.
      for (const chatId of subscriptions.keys()) {
        send({ id: nextCommandId(), type: 'chat.subscribe', payload: { chatId } });
      }
      // AC-RT-02 / AC-RT-04. Once subscriptions are re-armed, ask the
      // server to reconcile per-chat state. Any events that arrive
      // between now and the matching sync.response are still delivered
      // to the listener, but the listener is expected to defer marking
      // the chat contiguous until onSyncAdvice fires (see §6.2).
      sendSyncRequestForAll();
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
    if (envelope.type === 'sync.response') {
      dispatchSyncResponse(envelope.payload as SyncResponsePayload);
      return;
    }
    if (
      envelope.type !== 'message.created' &&
      envelope.type !== 'message.edited' &&
      envelope.type !== 'message.deleted'
    ) {
      return;
    }
    const payload = envelope.payload as { chatId?: unknown };
    const chatId = typeof payload.chatId === 'string' ? payload.chatId : null;
    if (chatId === null) return;
    const sub = subscriptions.get(chatId);
    if (sub === undefined) return;
    const event: ChatRealtimeEvent =
      envelope.type === 'message.created'
        ? { type: 'message.created', payload: envelope.payload as MessageCreatedPayload }
        : envelope.type === 'message.edited'
          ? { type: 'message.edited', payload: envelope.payload as MessageEditedPayload }
          : { type: 'message.deleted', payload: envelope.payload as MessageDeletedPayload };
    sub.onEvent(event);
  }

  function dispatchSyncResponse(payload: SyncResponsePayload): void {
    for (const entry of payload.chats) {
      const sub = subscriptions.get(entry.chatId);
      if (sub === undefined || sub.onSyncAdvice === undefined) continue;
      sub.onSyncAdvice(toAdvice(entry));
    }
  }

  function toAdvice(entry: SyncResponseChatEntry): RealtimeSyncAdvice {
    const base: RealtimeSyncAdvice = {
      headSequence: entry.headSequence,
      serverReadSequence: entry.serverReadSequence,
      advice: entry.advice,
    };
    if (entry.rangeHint !== undefined) {
      base.rangeHint = {
        fromSequence: entry.rangeHint.fromSequence,
        toSequence: entry.rangeHint.toSequence,
      };
    }
    return base;
  }

  function subscribeToChat(chatId: string, options: ChatSubscribeOptions): () => void {
    const hadSubscription = subscriptions.has(chatId);
    const subscription: ChatSubscription = { onEvent: options.onEvent };
    if (options.onSyncAdvice !== undefined) subscription.onSyncAdvice = options.onSyncAdvice;
    if (options.getSyncState !== undefined) subscription.getSyncState = options.getSyncState;
    subscriptions.set(chatId, subscription);
    if (!hadSubscription) {
      send({ id: nextCommandId(), type: 'chat.subscribe', payload: { chatId } });
      // If the socket was already OPEN when this subscribe landed,
      // request a sync so the new chat is reconciled immediately.
      // The initial-connect sync.request path above covers the other
      // case (subscription added while socket was still CONNECTING).
      if (socket !== null && socket.readyState === WebSocket.OPEN) {
        sendSyncRequestForAll();
      }
    }
    return () => {
      const current = subscriptions.get(chatId);
      if (current !== subscription) return;
      subscriptions.delete(chatId);
      send({ id: nextCommandId(), type: 'chat.unsubscribe', payload: { chatId } });
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
    subscriptions.clear();
  }

  openSocket();
  return { subscribeToChat, close };
}

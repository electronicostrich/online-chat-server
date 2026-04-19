import { randomUUID } from 'node:crypto';
import type {
  MessageCreatedPayload,
  MessageDeletedPayload,
  MessageEditedPayload,
  ReadstateUpdatedPayload,
  SessionRevokedPayload,
} from 'shared-schemas';
import { WS_CLOSE_CODES } from 'shared-schemas';
import { deliverOrDrop } from './delivery.js';
import { socketsForSession, socketsForUser, allSockets } from './registry.js';
import type { OutboundEvent, SocketContext } from './types.js';

function now(): string {
  return new Date().toISOString();
}

function authorizedForChat(ctx: SocketContext, chatId: string): boolean {
  // A socket receives a chat-scoped event only if it has an active
  // subscription for that chat. Authorization to subscribe is checked
  // at subscribe-time by the gateway — if a member loses access the
  // gateway will tear that subscription down (follow-up work), so for
  // now we trust the subscription set.
  return ctx.subscriptions.has(chatId);
}

export function publishMessageCreated(payload: MessageCreatedPayload): void {
  const event: OutboundEvent = {
    eventId: randomUUID(),
    type: 'message.created',
    occurredAt: now(),
    payload,
  };
  for (const ctx of allSockets()) {
    if (authorizedForChat(ctx, payload.chatId)) deliverOrDrop(ctx, event);
  }
}

export function publishMessageEdited(payload: MessageEditedPayload): void {
  const event: OutboundEvent = {
    eventId: randomUUID(),
    type: 'message.edited',
    occurredAt: now(),
    payload,
  };
  for (const ctx of allSockets()) {
    if (authorizedForChat(ctx, payload.chatId)) deliverOrDrop(ctx, event);
  }
}

export function publishMessageDeleted(payload: MessageDeletedPayload): void {
  const event: OutboundEvent = {
    eventId: randomUUID(),
    type: 'message.deleted',
    occurredAt: now(),
    payload,
  };
  for (const ctx of allSockets()) {
    if (authorizedForChat(ctx, payload.chatId)) deliverOrDrop(ctx, event);
  }
}

// Read state is a per-user fact. Fan out only to the caller's own
// sessions, regardless of chat subscription, because a second tab that
// hasn't subscribed still cares when the first tab clears unread.
export function publishReadstateUpdated(payload: ReadstateUpdatedPayload): void {
  const event: OutboundEvent = {
    eventId: randomUUID(),
    type: 'readstate.updated',
    occurredAt: now(),
    payload,
  };
  for (const ctx of socketsForUser(payload.userId)) {
    deliverOrDrop(ctx, event);
  }
}

// Session revocation: deliver `session.revoked` only to the revoked
// session's live socket (if any), and then tear the connection down so
// a client that kept the socket open past revocation cannot continue
// receiving events.
export function publishSessionRevoked(payload: SessionRevokedPayload): void {
  const targets = socketsForSession(payload.sessionId);
  if (targets.length === 0) return;
  const event: OutboundEvent = {
    eventId: randomUUID(),
    type: 'session.revoked',
    occurredAt: now(),
    payload,
  };
  for (const ctx of targets) {
    deliverOrDrop(ctx, event);
    try {
      ctx.socket.close(WS_CLOSE_CODES.SESSION_REVOKED, 'session revoked');
    } catch {
      // Socket already torn down — nothing more to do.
    }
  }
}

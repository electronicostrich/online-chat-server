import { randomUUID } from 'node:crypto';
import type {
  MessageCreatedPayload,
  MessageDeletedPayload,
  MessageEditedPayload,
  ReadstateUpdatedPayload,
  RoomBanUpdatedPayload,
  RoomInvitationCreatedPayload,
  RoomMembershipUpdatedPayload,
  SessionRevokedPayload,
} from 'shared-schemas';
import { WS_CLOSE_CODES } from 'shared-schemas';
import { userCanReadChat } from './authorization.js';
import { deliverOrDrop } from './delivery.js';
import {
  socketsForSession,
  socketsForUser,
  allSockets,
} from './registry.js';
import type { OutboundEvent, SocketContext } from './types.js';

function now(): string {
  return new Date().toISOString();
}

// Per-chat fan-out. For each socket that has subscribed to this chat
// we re-verify the subscriber's current access before delivery.
// `chat.subscribe` checks access at subscribe time, but a subsequent
// room-removal / ban / chat-delete would leave the subscription in
// place; re-checking here is the last-gate guarantee that revoked
// users never see post-revocation events. The stale subscription is
// cleared on first missed event so subsequent events don't re-query.
async function fanOutToChatSubscribers(
  chatId: string,
  event: OutboundEvent,
): Promise<void> {
  // Take a snapshot first — deliverOrDrop / unregisterSocket mutate
  // the underlying Sets, and removing while iterating across the
  // async boundary would skip contexts.
  const targets: SocketContext[] = allSockets().filter((c) =>
    c.subscriptions.has(chatId),
  );
  // Unique `(userId, chatId)` pairs so we don't hit the DB once per
  // tab of the same user.
  const decisionByUser = new Map<string, boolean>();
  for (const ctx of targets) {
    let allowed = decisionByUser.get(ctx.userId);
    if (allowed === undefined) {
      allowed = await userCanReadChat(chatId, ctx.userId);
      decisionByUser.set(ctx.userId, allowed);
    }
    if (!allowed) {
      // Access revoked — drop the stale subscription so the next
      // event skips the re-check, and skip delivery of this event.
      ctx.subscriptions.delete(chatId);
      continue;
    }
    deliverOrDrop(ctx, event);
  }
}

export async function publishMessageCreated(
  payload: MessageCreatedPayload,
): Promise<void> {
  const event: OutboundEvent = {
    eventId: randomUUID(),
    type: 'message.created',
    occurredAt: now(),
    payload,
  };
  await fanOutToChatSubscribers(payload.chatId, event);
}

export async function publishMessageEdited(
  payload: MessageEditedPayload,
): Promise<void> {
  const event: OutboundEvent = {
    eventId: randomUUID(),
    type: 'message.edited',
    occurredAt: now(),
    payload,
  };
  await fanOutToChatSubscribers(payload.chatId, event);
}

export async function publishMessageDeleted(
  payload: MessageDeletedPayload,
): Promise<void> {
  const event: OutboundEvent = {
    eventId: randomUUID(),
    type: 'message.deleted',
    occurredAt: now(),
    payload,
  };
  await fanOutToChatSubscribers(payload.chatId, event);
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

// Fanned out to every current subscriber of `chatId` PLUS to every
// live socket of the affected user (so the user's own tabs react even
// if they never subscribed — e.g. a tab that only has the catalog open
// still needs to learn it was just removed). The union is
// de-duplicated so no socket receives the event twice. No per-event
// authorization re-check here: the WS-03 service layer has already
// committed the transition, and the transient window where a
// just-removed user still sees one final event announcing their own
// removal is the desired UX.
function fanOutRoomEventIncludingSubject(
  chatId: string,
  subjectUserId: string,
  event: OutboundEvent,
): void {
  const delivered = new Set<SocketContext>();
  for (const ctx of allSockets()) {
    if (ctx.subscriptions.has(chatId)) {
      deliverOrDrop(ctx, event);
      delivered.add(ctx);
    }
  }
  for (const ctx of socketsForUser(subjectUserId)) {
    if (delivered.has(ctx)) continue;
    deliverOrDrop(ctx, event);
    delivered.add(ctx);
  }
}

// Fired on `POST /rooms/{id}/invitations`. Only the invitee's own
// sockets see it — other users have no need to know the room had an
// invitation issued, and leaking invitee identity to room subscribers
// would be a privacy regression.
export function publishRoomInvitationCreated(
  payload: RoomInvitationCreatedPayload,
  inviteeUserId: string,
): void {
  const event: OutboundEvent = {
    eventId: randomUUID(),
    type: 'room.invitation.created',
    occurredAt: now(),
    payload,
  };
  for (const ctx of socketsForUser(inviteeUserId)) {
    deliverOrDrop(ctx, event);
  }
}

// Fired on join / accept-invite / leave / remove-member /
// make-admin / remove-admin. See `fanOutRoomEventIncludingSubject`.
export function publishRoomMembershipUpdated(
  payload: RoomMembershipUpdatedPayload,
): void {
  const event: OutboundEvent = {
    eventId: randomUUID(),
    type: 'room.membership.updated',
    occurredAt: now(),
    payload,
  };
  fanOutRoomEventIncludingSubject(payload.chatId, payload.userId, event);
}

// Fired on remove-member (isBanned=true) and unban (isBanned=false).
// See `fanOutRoomEventIncludingSubject`.
export function publishRoomBanUpdated(payload: RoomBanUpdatedPayload): void {
  const event: OutboundEvent = {
    eventId: randomUUID(),
    type: 'room.ban.updated',
    occurredAt: now(),
    payload,
  };
  fanOutRoomEventIncludingSubject(payload.chatId, payload.userId, event);
}

// Session revocation: deliver `session.revoked` to every live socket
// bound to the revoked session (multiple tabs may share the session
// cookie), then tear each down so none can keep receiving events.
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

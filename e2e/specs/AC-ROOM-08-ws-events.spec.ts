import { test, expect, request as apiRequest } from '@playwright/test';
import { csrfHeaders, register } from '../utils/auth.js';
import {
  connectWebSocket,
  cookieHeaderFromSetCookie,
  type ReceivedEvent,
} from '../utils/websocket.js';

function uniqueSuffix(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

interface RoomMembershipUpdatedPayload {
  chatId: string;
  userId: string;
  membershipState: 'member' | 'left';
  role: 'owner' | 'admin' | 'member';
}

function isMembershipPayload(
  value: unknown,
): value is RoomMembershipUpdatedPayload {
  if (typeof value !== 'object' || value === null) return false;
  const r = value as Record<string, unknown>;
  const isMembershipState =
    r.membershipState === 'member' || r.membershipState === 'left';
  const isRole =
    r.role === 'owner' || r.role === 'admin' || r.role === 'member';
  return (
    typeof r.chatId === 'string' &&
    typeof r.userId === 'string' &&
    isMembershipState &&
    isRole
  );
}

// AC-ROOM-08 traceability lists `room.membership.updated × N` as the
// event emission on room deletion. The service enumerates every active
// membership inside the soft-delete transaction so the fan-out snapshot
// reflects the state at the moment the room went away; each member's
// live sockets then see `membershipState: 'left'` with the role they
// held, even on tabs that never subscribed to the room chat.
test.describe('AC-ROOM-08: delete-room fans out room.membership.updated × N', () => {
  test('every active member receives a left event on their own socket', async () => {
    const suffix = uniqueSuffix();
    const owner = {
      email: `room8ws-owner-${suffix}@example.com`,
      username: `room8ws_owner_${suffix}`.replace(/-/g, '_'),
      password: 'StrongPassword123!',
    };
    const bob = {
      email: `room8ws-bob-${suffix}@example.com`,
      username: `room8ws_bob_${suffix}`.replace(/-/g, '_'),
      password: 'StrongPassword123!',
    };
    const carol = {
      email: `room8ws-carol-${suffix}@example.com`,
      username: `room8ws_carol_${suffix}`.replace(/-/g, '_'),
      password: 'StrongPassword123!',
    };

    const seed = await apiRequest.newContext({ baseURL: 'http://localhost:3000' });
    try {
      const res = await seed.post('/__test/seed', {
        data: { strategy: 'truncate' },
      });
      expect(res.status()).toBe(200);
    } finally {
      await seed.dispose();
    }

    const ownerCtx = await apiRequest.newContext({ baseURL: 'http://localhost:3000' });
    const bobCtx = await apiRequest.newContext({ baseURL: 'http://localhost:3000' });
    const carolCtx = await apiRequest.newContext({ baseURL: 'http://localhost:3000' });
    try {
      const ownerSession = await register(ownerCtx, owner);
      const bobSession = await register(bobCtx, bob);
      const carolSession = await register(carolCtx, carol);

      const create = await ownerCtx.post('/rooms', {
        headers: csrfHeaders(ownerSession),
        data: { name: `room8ws-${suffix}`, visibility: 'public' },
      });
      expect(create.status()).toBe(200);
      const {
        data: { room },
      } = (await create.json()) as { data: { room: { chatId: string } } };

      const joinBob = await bobCtx.post(`/rooms/${room.chatId}/join`, {
        headers: csrfHeaders(bobSession),
      });
      expect(joinBob.status()).toBe(200);
      const joinCarol = await carolCtx.post(`/rooms/${room.chatId}/join`, {
        headers: csrfHeaders(carolSession),
      });
      expect(joinCarol.status()).toBe(200);

      const ownerWs = await connectWebSocket({
        cookieHeader: cookieHeaderFromSetCookie(ownerSession.response),
      });
      const bobWs = await connectWebSocket({
        cookieHeader: cookieHeaderFromSetCookie(bobSession.response),
      });
      const carolWs = await connectWebSocket({
        cookieHeader: cookieHeaderFromSetCookie(carolSession.response),
      });
      try {
        // Owner subscribes to the chat so its socket takes the
        // subscriber path of `fanOutRoomEventIncludingSubject` and
        // receives every member's event, not just its own.
        ownerWs.send({
          id: 'sub-owner',
          type: 'chat.subscribe',
          payload: { chatId: room.chatId },
        });
        await ownerWs.nextEvent((ev) => ev.type === 'chat.subscribe.ack');
        // Bob and Carol do not subscribe. They heartbeat so the
        // 2.5s test-mode stale sweep does not close them before the
        // delete fan-out lands. The subject-union path is the
        // load-bearing check: each of their sockets must still see the
        // event where it is the subject.
        bobWs.send({ id: 'hb-bob', type: 'presence.heartbeat', payload: {} });
        carolWs.send({ id: 'hb-carol', type: 'presence.heartbeat', payload: {} });

        const deleteRes = await ownerCtx.delete(`/rooms/${room.chatId}`, {
          headers: csrfHeaders(ownerSession),
        });
        expect(deleteRes.status()).toBe(200);

        const leftForOwner = (ev: ReceivedEvent): boolean =>
          ev.type === 'room.membership.updated' &&
          isMembershipPayload(ev.payload) &&
          ev.payload.chatId === room.chatId &&
          ev.payload.userId === ownerSession.userId &&
          ev.payload.membershipState === 'left' &&
          ev.payload.role === 'owner';
        const leftForBob = (ev: ReceivedEvent): boolean =>
          ev.type === 'room.membership.updated' &&
          isMembershipPayload(ev.payload) &&
          ev.payload.chatId === room.chatId &&
          ev.payload.userId === bobSession.userId &&
          ev.payload.membershipState === 'left' &&
          ev.payload.role === 'member';
        const leftForCarol = (ev: ReceivedEvent): boolean =>
          ev.type === 'room.membership.updated' &&
          isMembershipPayload(ev.payload) &&
          ev.payload.chatId === room.chatId &&
          ev.payload.userId === carolSession.userId &&
          ev.payload.membershipState === 'left' &&
          ev.payload.role === 'member';

        // Owner's subscribed socket: three events, one per member.
        const ownerEvents = await Promise.all([
          ownerWs.nextEvent(leftForOwner, 3_000),
          ownerWs.nextEvent(leftForBob, 3_000),
          ownerWs.nextEvent(leftForCarol, 3_000),
        ]);
        for (const ev of ownerEvents) {
          expect(ev.type).toBe('room.membership.updated');
        }

        // Bob's non-subscribed socket: reached via the subject path
        // with his own user id. He must not see the owner's or
        // Carol's event (subject path delivers only the socket's own
        // user's events).
        const bobEv = await bobWs.nextEvent(
          (ev) => ev.type === 'room.membership.updated',
          3_000,
        );
        expect(leftForBob(bobEv)).toBe(true);

        const carolEv = await carolWs.nextEvent(
          (ev) => ev.type === 'room.membership.updated',
          3_000,
        );
        expect(leftForCarol(carolEv)).toBe(true);

        // Negative assertions: no fourth `room.membership.updated`
        // should reach any of the three sockets. A duplicate would
        // indicate the subject path and the subscriber path both
        // fired for the owner (de-dup regression), or that Bob /
        // Carol's socket received a peer's event (subject-path
        // over-fan-out regression). Short grace window (600ms) — the
        // publishers run synchronously, so any extra frame would have
        // landed long before this returns.
        const expectNoMoreMembershipFrames = async (
          client: typeof ownerWs,
          who: string,
        ): Promise<void> => {
          try {
            const extra = await client.nextEvent(
              (ev) => ev.type === 'room.membership.updated',
              600,
            );
            throw new Error(
              `unexpected extra room.membership.updated on ${who}: ${JSON.stringify(extra.payload)}`,
            );
          } catch (err) {
            // nextEvent rejects with a timeout-shaped Error when no
            // matching frame arrives — that's the pass path.
            if ((err as Error).message.startsWith('unexpected extra')) {
              throw err;
            }
          }
        };
        await Promise.all([
          expectNoMoreMembershipFrames(ownerWs, 'owner'),
          expectNoMoreMembershipFrames(bobWs, 'bob'),
          expectNoMoreMembershipFrames(carolWs, 'carol'),
        ]);
      } finally {
        await ownerWs.close();
        await bobWs.close();
        await carolWs.close();
      }
    } finally {
      await ownerCtx.dispose();
      await bobCtx.dispose();
      await carolCtx.dispose();
    }
  });
});

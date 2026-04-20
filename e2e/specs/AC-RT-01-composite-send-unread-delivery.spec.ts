import { test, expect, request as apiRequest } from '@playwright/test';
import { csrfHeaders, register } from '../utils/auth.js';
import {
  connectWebSocket,
  cookieHeaderFromSetCookie,
  type ReceivedEvent,
} from '../utils/websocket.js';

// Cross-workstream composite spec owned by WS-08 per the test-ownership
// table in docs/workstreams/workstream-dependency-and-interface-map.md
// ("send message -> unread update -> websocket delivery"). The AC-RT-01
// row is the user-visible contract this spec strengthens; the spec
// proves the seam end-to-end by chaining three workstreams in one
// linear timeline against the real running stack:
//
//   - WS-03: POST /rooms (AC-ROOM-01), POST /rooms/{id}/join
//     (AC-ROOM-05) — provides the membership that both the unread
//     counter and the websocket fan-out depend on.
//   - WS-04: POST /chats/{chatId}/messages (AC-MSG-01),
//     GET /chats/{chatId}/read-state (AC-UNREAD-01),
//     POST /chats/{chatId}/read (AC-UNREAD-03).
//   - WS-05: /ws chat.subscribe + message.created (AC-RT-01).
//
// The existing single-AC specs each cover one leg of this flow; none
// proves that the three legs stay consistent on a single timeline.
// Specifically: that a REST send observed by the unread-counter reader
// (Bob without a live socket) is the SAME write that a live subscriber
// (Bob with a socket) would see as message.created, and that an
// explicit read-advance does not desynchronise the next send's
// delivery.

function uniqueSuffix(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

interface ReadState {
  data: {
    lastReadSequence: number;
    headSequence: number;
    hasUnread: boolean;
  };
}

interface MessageCreatedPayload {
  chatId: string;
  headSequence: number;
  message: {
    id: string;
    chatId: string;
    sequence: number;
    authorUserId: string;
    bodyText: string | null;
  };
}

function assertMessageCreated(
  event: ReceivedEvent,
): asserts event is ReceivedEvent & { payload: MessageCreatedPayload } {
  if (
    typeof event.payload !== 'object' ||
    event.payload === null ||
    !('message' in event.payload)
  ) {
    throw new Error(
      `expected message.created payload shape, got ${JSON.stringify(event.payload)}`,
    );
  }
}

test.describe('AC-RT-01 composite: send → unread → websocket delivery', () => {
  test('offline-unread and live-delivery stay consistent across one send timeline', async () => {
    const suffix = uniqueSuffix();
    const alice = {
      email: `alice-rt1c-${suffix}@example.com`,
      username: `alice_rt1c_${suffix}`.replace(/-/g, '_'),
      password: 'StrongPassword123!',
    };
    const bob = {
      email: `bob-rt1c-${suffix}@example.com`,
      username: `bob_rt1c_${suffix}`.replace(/-/g, '_'),
      password: 'StrongPassword123!',
    };

    // No global /__test/seed truncate: every identifier used below
    // (emails, usernames, room name) is suffix-namespaced, and every
    // assertion is scoped to the room Alice creates in-test, so a
    // shared DB between parallel workers can't leak into this spec.
    // Truncating here would instead corrupt other E2E workers'
    // state mid-run if the suite is ever parallelised.
    const aliceCtx = await apiRequest.newContext({ baseURL: 'http://localhost:3000' });
    const bobCtx = await apiRequest.newContext({ baseURL: 'http://localhost:3000' });
    try {
      const aliceSession = await register(aliceCtx, alice);
      const bobSession = await register(bobCtx, bob);

      // WS-03: Alice creates a public room; Bob joins via the real
      // join endpoint. Membership established via production paths, not
      // via the WS-08 seed helper.
      const createRoom = await aliceCtx.post('/rooms', {
        headers: csrfHeaders(aliceSession),
        data: { name: `rt1c-${suffix}`, visibility: 'public' },
      });
      expect(createRoom.status()).toBe(200);
      const {
        data: { room },
      } = (await createRoom.json()) as { data: { room: { chatId: string } } };

      const join = await bobCtx.post(`/rooms/${room.chatId}/join`, {
        headers: csrfHeaders(bobSession),
      });
      expect(join.status()).toBe(200);

      // Baseline: Bob has never opened the chat, no messages exist.
      const baseline = await bobCtx.get(`/chats/${room.chatId}/read-state`);
      expect(baseline.status()).toBe(200);
      const baselineRs = (await baseline.json()) as ReadState;
      expect(baselineRs.data.headSequence).toBe(0);
      expect(baselineRs.data.lastReadSequence).toBe(0);
      expect(baselineRs.data.hasUnread).toBe(false);

      // --- Leg 1: offline unread -----------------------------------
      // Alice sends while Bob has NO websocket. The unread counter
      // must reflect the send purely from the HTTP surface.
      const send1 = await aliceCtx.post(`/chats/${room.chatId}/messages`, {
        headers: csrfHeaders(aliceSession),
        data: { bodyText: 'offline-1' },
      });
      expect(send1.status()).toBe(200);

      const afterSend1 = await bobCtx.get(`/chats/${room.chatId}/read-state`);
      expect(afterSend1.status()).toBe(200);
      const rs1 = (await afterSend1.json()) as ReadState;
      expect(rs1.data.headSequence).toBe(1);
      expect(rs1.data.lastReadSequence).toBe(0);
      expect(rs1.data.hasUnread).toBe(true);

      // --- Leg 2: live delivery ------------------------------------
      // Bob connects + subscribes. The next send must reach his socket
      // as message.created, not just bump the unread counter.
      const bobCookie = cookieHeaderFromSetCookie(bobSession.response);
      const bobWs = await connectWebSocket({ cookieHeader: bobCookie });
      try {
        bobWs.send({
          id: 'sub-1',
          type: 'chat.subscribe',
          payload: { chatId: room.chatId },
        });
        const ack = await bobWs.nextEvent(
          (ev) => ev.type === 'chat.subscribe.ack',
        );
        expect(ack.type).toBe('chat.subscribe.ack');

        const send2 = await aliceCtx.post(`/chats/${room.chatId}/messages`, {
          headers: csrfHeaders(aliceSession),
          data: { bodyText: 'live-2' },
        });
        expect(send2.status()).toBe(200);

        const evt2 = await bobWs.nextEvent(
          (ev) => ev.type === 'message.created',
        );
        assertMessageCreated(evt2);
        expect(evt2.payload.chatId).toBe(room.chatId);
        expect(evt2.payload.headSequence).toBe(2);
        expect(evt2.payload.message.sequence).toBe(2);
        expect(evt2.payload.message.authorUserId).toBe(aliceSession.userId);
        expect(evt2.payload.message.bodyText).toBe('live-2');

        // Live delivery must NOT auto-advance the read watermark — the
        // unread contract is explicit-advance-only, so even after Bob
        // saw leg-2 on his socket, the REST read-state still reports
        // unread because he hasn't called POST /read.
        const afterSend2 = await bobCtx.get(`/chats/${room.chatId}/read-state`);
        expect(afterSend2.status()).toBe(200);
        const rs2 = (await afterSend2.json()) as ReadState;
        expect(rs2.data.headSequence).toBe(2);
        expect(rs2.data.lastReadSequence).toBe(0);
        expect(rs2.data.hasUnread).toBe(true);

        // --- Leg 3: explicit advance clears unread ----------------
        const advance = await bobCtx.post(`/chats/${room.chatId}/read`, {
          headers: csrfHeaders(bobSession),
          data: { readUpToSequence: 2 },
        });
        expect(advance.status()).toBe(200);

        const afterAdvance = await bobCtx.get(`/chats/${room.chatId}/read-state`);
        expect(afterAdvance.status()).toBe(200);
        const rs3 = (await afterAdvance.json()) as ReadState;
        expect(rs3.data.headSequence).toBe(2);
        expect(rs3.data.lastReadSequence).toBe(2);
        expect(rs3.data.hasUnread).toBe(false);

        // --- Leg 4: next send re-opens unread + fans out live ----
        // After advance, the next send must BOTH deliver message.created
        // on Bob's still-open socket AND reopen the unread indicator on
        // the HTTP surface. This is the assertion the composite adds
        // over the per-AC specs: one write, two consistent surfaces.
        const send3 = await aliceCtx.post(`/chats/${room.chatId}/messages`, {
          headers: csrfHeaders(aliceSession),
          data: { bodyText: 'after-advance-3' },
        });
        expect(send3.status()).toBe(200);

        const evt3 = await bobWs.nextEvent(
          (ev) => ev.type === 'message.created',
        );
        assertMessageCreated(evt3);
        expect(evt3.payload.headSequence).toBe(3);
        expect(evt3.payload.message.sequence).toBe(3);
        expect(evt3.payload.message.bodyText).toBe('after-advance-3');

        const finalRs = await bobCtx.get(`/chats/${room.chatId}/read-state`);
        expect(finalRs.status()).toBe(200);
        const rs4 = (await finalRs.json()) as ReadState;
        expect(rs4.data.headSequence).toBe(3);
        expect(rs4.data.lastReadSequence).toBe(2);
        expect(rs4.data.hasUnread).toBe(true);
      } finally {
        await bobWs.close();
      }
    } finally {
      await aliceCtx.dispose();
      await bobCtx.dispose();
    }
  });
});

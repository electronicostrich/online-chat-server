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

// Local shape rather than importing `MessageCreatedPayload` from
// shared-schemas: other e2e specs (AC-MSG-01 etc.) follow the same
// pattern, keeping the e2e package self-contained without depending
// on shared-schemas's dist being built before lint runs in CI.
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

// AC-RT-01: connected users in an active chat receive a message.created
// event over the websocket after another user sends via REST, without
// any polling. The server is the authority; the client subscribes to
// the chat and the gateway fans out to every subscriber that still
// passes the membership check.
test.describe('AC-RT-01: realtime delivery', () => {
  test('ws subscriber receives message.created after REST send', async () => {
    const suffix = uniqueSuffix();
    const owner = {
      email: `rt1-owner-${suffix}@example.com`,
      username: `rt1_owner_${suffix}`.replace(/-/g, '_'),
      password: 'StrongPassword123!',
    };
    const member = {
      email: `rt1-member-${suffix}@example.com`,
      username: `rt1_member_${suffix}`.replace(/-/g, '_'),
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
    const memberCtx = await apiRequest.newContext({ baseURL: 'http://localhost:3000' });
    try {
      const ownerSession = await register(ownerCtx, owner);
      const memberSession = await register(memberCtx, member);

      const createRoom = await ownerCtx.post('/rooms', {
        headers: csrfHeaders(ownerSession),
        data: { name: `rt1-${suffix}`, visibility: 'public' },
      });
      expect(createRoom.status()).toBe(200);
      const {
        data: { room },
      } = (await createRoom.json()) as { data: { room: { chatId: string } } };

      const appendSeed = await apiRequest.newContext({ baseURL: 'http://localhost:3000' });
      try {
        const res = await appendSeed.post('/__test/seed', {
          data: {
            strategy: 'append',
            roomMembershipsByChatId: [
              { chatId: room.chatId, username: member.username, role: 'member' },
            ],
          },
        });
        expect(res.status()).toBe(200);
      } finally {
        await appendSeed.dispose();
      }

      const memberCookie = cookieHeaderFromSetCookie(memberSession.response);
      const memberWs = await connectWebSocket({ cookieHeader: memberCookie });
      try {
        memberWs.send({
          id: 'sub-1',
          type: 'chat.subscribe',
          payload: { chatId: room.chatId },
        });
        const ack = await memberWs.nextEvent(
          (ev) => ev.type === 'chat.subscribe.ack',
        );
        expect(ack.type).toBe('chat.subscribe.ack');

        // Owner sends a REST message; the member's live socket must
        // see message.created without any polling.
        const send = await ownerCtx.post(`/chats/${room.chatId}/messages`, {
          headers: csrfHeaders(ownerSession),
          data: { bodyText: 'hello subscriber' },
        });
        expect(send.status()).toBe(200);

        const evt = await memberWs.nextEvent(
          (ev) => ev.type === 'message.created',
        );
        // Narrow the event's payload with an assertion rather than
        // carrying an `as` cast through — the type-aware lint run
        // otherwise keeps `evt.payload.*` as unsafe any.
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
        assertMessageCreated(evt);
        expect(evt.eventId).toMatch(
          /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
        );
        expect(evt.payload.chatId).toBe(room.chatId);
        expect(evt.payload.headSequence).toBe(1);
        expect(evt.payload.message.sequence).toBe(1);
        expect(evt.payload.message.authorUserId).toBe(ownerSession.userId);
        expect(evt.payload.message.bodyText).toBe('hello subscriber');
      } finally {
        await memberWs.close();
      }
    } finally {
      await ownerCtx.dispose();
      await memberCtx.dispose();
    }
  });
});

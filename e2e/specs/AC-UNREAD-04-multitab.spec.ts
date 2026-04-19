import { test, expect, request as apiRequest } from '@playwright/test';
import { csrfHeaders, login, register } from '../utils/auth.js';
import {
  connectWebSocket,
  cookieHeaderFromSetCookie,
  type ReceivedEvent,
} from '../utils/websocket.js';

function uniqueSuffix(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

interface ReadstateUpdatedPayload {
  chatId: string;
  userId: string;
  lastReadSequence: number;
}

// AC-UNREAD-04: after one tab calls POST /chats/{id}/read, every OTHER
// tab bound to a different session of the same user receives a
// readstate.updated event with the clamped lastReadSequence. Other
// users connected to the same chat MUST NOT see this event — read
// state is a per-user fact.
test.describe('AC-UNREAD-04: multi-tab read-state consistency', () => {
  test('readstate.updated reaches the user\'s other sessions but not other users', async () => {
    const suffix = uniqueSuffix();
    const author = {
      email: `u04-author-${suffix}@example.com`,
      username: `u04_author_${suffix}`.replace(/-/g, '_'),
      password: 'StrongPassword123!',
    };
    const reader = {
      email: `u04-reader-${suffix}@example.com`,
      username: `u04_reader_${suffix}`.replace(/-/g, '_'),
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

    const authorCtx = await apiRequest.newContext({ baseURL: 'http://localhost:3000' });
    // Two sessions for the reader (tab 1 and tab 2) and a separate
    // context for the other user, so the "other users don't see it"
    // assertion is genuine.
    const readerTabA = await apiRequest.newContext({ baseURL: 'http://localhost:3000' });
    const readerTabB = await apiRequest.newContext({ baseURL: 'http://localhost:3000' });
    try {
      const authorSession = await register(authorCtx, author);
      const readerSessionA = await register(readerTabA, reader);
      const readerSessionB = await login(readerTabB, {
        email: reader.email,
        password: reader.password,
      });
      expect(readerSessionA.sessionId).not.toBe(readerSessionB.sessionId);

      const createRoom = await authorCtx.post('/rooms', {
        headers: csrfHeaders(authorSession),
        data: { name: `u04-${suffix}`, visibility: 'public' },
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
              { chatId: room.chatId, username: reader.username, role: 'member' },
            ],
          },
        });
        expect(res.status()).toBe(200);
      } finally {
        await appendSeed.dispose();
      }

      // Author sends a few messages so the reader has unread.
      for (let i = 1; i <= 3; i++) {
        const res = await authorCtx.post(`/chats/${room.chatId}/messages`, {
          headers: csrfHeaders(authorSession),
          data: { bodyText: `msg-${i.toString()}` },
        });
        expect(res.status()).toBe(200);
      }

      const tabACookie = cookieHeaderFromSetCookie(readerSessionA.response);
      const tabBCookie = cookieHeaderFromSetCookie(readerSessionB.response);
      const authorCookie = cookieHeaderFromSetCookie(authorSession.response);

      const wsTabA = await connectWebSocket({ cookieHeader: tabACookie });
      const wsTabB = await connectWebSocket({ cookieHeader: tabBCookie });
      const wsAuthor = await connectWebSocket({ cookieHeader: authorCookie });
      try {
        // All three subscribe so the author has a real connection too;
        // if the author accidentally received readstate.updated, that
        // would show up here.
        for (const w of [wsTabA, wsTabB, wsAuthor]) {
          w.send({
            id: 'sub',
            type: 'chat.subscribe',
            payload: { chatId: room.chatId },
          });
          await w.nextEvent((ev) => ev.type === 'chat.subscribe.ack');
        }

        // Tab A advances read-state to the current head.
        const advance = await readerTabA.post(`/chats/${room.chatId}/read`, {
          headers: csrfHeaders(readerSessionA),
          data: { readUpToSequence: 3 },
        });
        expect(advance.status()).toBe(200);

        // Tab B must see readstate.updated with the advanced value.
        const evt = (await wsTabB.nextEvent(
          (ev) => ev.type === 'readstate.updated',
        )) as ReceivedEvent & { payload: ReadstateUpdatedPayload };
        expect(evt.payload.chatId).toBe(room.chatId);
        expect(evt.payload.userId).toBe(readerSessionA.userId);
        expect(evt.payload.lastReadSequence).toBe(3);

        // Tab A (the initiating tab) also gets the event — the server
        // fans out to all the user's sessions uniformly, because the
        // client can't distinguish which tab on the server side
        // originated the advance.
        const evtA = (await wsTabA.nextEvent(
          (ev) => ev.type === 'readstate.updated',
        )) as ReceivedEvent & { payload: ReadstateUpdatedPayload };
        expect(evtA.payload.lastReadSequence).toBe(3);

        // Author must NOT receive readstate.updated — read state is
        // per-user, not per-chat. Allow a small window before asserting
        // emptiness so out-of-order frames would fail the test.
        const timeoutMs = 500;
        await expect(
          wsAuthor.nextEvent((ev) => ev.type === 'readstate.updated', timeoutMs),
        ).rejects.toThrow(/timeout/i);
      } finally {
        await wsTabA.close();
        await wsTabB.close();
        await wsAuthor.close();
      }
    } finally {
      await authorCtx.dispose();
      await readerTabA.dispose();
      await readerTabB.dispose();
    }
  });
});

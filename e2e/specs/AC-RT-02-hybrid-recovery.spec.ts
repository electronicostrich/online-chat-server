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

interface SyncResponsePayload {
  replyToCommandId: string;
  chats: {
    chatId: string;
    headSequence: number;
    serverReadSequence: number;
    advice: 'in-sync' | 'fetch-history' | 'chat-inaccessible';
    rangeHint?: { fromSequence: number; toSequence: number };
  }[];
}

interface HistoryMessageRow {
  id: string;
  sequence: number;
  bodyText: string | null;
}

interface HistoryResponseBody {
  data: {
    messages: HistoryMessageRow[];
  };
}

// AC-RT-02: after a websocket disconnect/reconnect the client can
// recover authoritative state. The sync.request → sync.response contract
// tells the client what it missed, and the HTTP history API is the
// durable source of truth for filling the gap. The test exercises both
// halves: `sync.request` advice + an HTTP history fetch that matches
// the rangeHint the server returned.
test.describe('AC-RT-02: hybrid reconnect recovery', () => {
  test('sync.response advice + HTTP history reconstruct missed messages', async () => {
    const suffix = uniqueSuffix();
    const owner = {
      email: `rt2-owner-${suffix}@example.com`,
      username: `rt2_owner_${suffix}`.replace(/-/g, '_'),
      password: 'StrongPassword123!',
    };
    const member = {
      email: `rt2-member-${suffix}@example.com`,
      username: `rt2_member_${suffix}`.replace(/-/g, '_'),
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
        data: { name: `rt2-${suffix}`, visibility: 'public' },
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

      // Owner posts three messages before the member's client ever
      // connects. These are the "missed while offline" window.
      for (let i = 1; i <= 3; i++) {
        const res = await ownerCtx.post(`/chats/${room.chatId}/messages`, {
          headers: csrfHeaders(ownerSession),
          data: { bodyText: `missed-${i.toString()}` },
        });
        expect(res.status()).toBe(200);
      }

      const memberCookie = cookieHeaderFromSetCookie(memberSession.response);
      const ws = await connectWebSocket({ cookieHeader: memberCookie });
      try {
        // Client rejoins after a disconnect: it has no local watermark
        // (sequence 0) and asks the server what's authoritative.
        ws.send({
          id: 'sync-1',
          type: 'sync.request',
          payload: {
            chats: [
              {
                chatId: room.chatId,
                lastKnownContiguousSequence: 0,
                lastKnownReadSequence: 0,
              },
            ],
          },
        });

        const evt = (await ws.nextEvent(
          (ev) => ev.type === 'sync.response',
        )) as ReceivedEvent & { payload: SyncResponsePayload };
        expect(evt.payload.replyToCommandId).toBe('sync-1');
        expect(evt.payload.chats).toHaveLength(1);
        const advice = evt.payload.chats[0];
        expect(advice).toBeDefined();
        if (advice === undefined) return;
        expect(advice.chatId).toBe(room.chatId);
        expect(advice.headSequence).toBe(3);
        expect(advice.serverReadSequence).toBe(0);
        expect(advice.advice).toBe('fetch-history');
        expect(advice.rangeHint).toEqual({ fromSequence: 1, toSequence: 3 });

        // The hybrid recovery contract says HTTP history is the
        // authoritative source for the gap. Use the rangeHint the
        // server just returned to fetch the missed window, and assert
        // the three messages are there in the right order.
        const rangeHint = advice.rangeHint;
        expect(rangeHint).toBeDefined();
        if (rangeHint === undefined) return;
        const afterSequence = rangeHint.fromSequence - 1;
        const history = await memberCtx.get(
          `/chats/${room.chatId}/messages?afterSequence=${afterSequence.toString()}`,
        );
        expect(history.status()).toBe(200);
        const historyBody = (await history.json()) as HistoryResponseBody;
        const bodies = historyBody.data.messages.map((m) => m.bodyText);
        expect(bodies).toEqual(['missed-1', 'missed-2', 'missed-3']);
      } finally {
        await ws.close();
      }
    } finally {
      await ownerCtx.dispose();
      await memberCtx.dispose();
    }
  });

  test('in-sync advice when client watermark matches head', async () => {
    const suffix = uniqueSuffix();
    const owner = {
      email: `rt2b-owner-${suffix}@example.com`,
      username: `rt2b_owner_${suffix}`.replace(/-/g, '_'),
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
    try {
      const ownerSession = await register(ownerCtx, owner);
      const createRoom = await ownerCtx.post('/rooms', {
        headers: csrfHeaders(ownerSession),
        data: { name: `rt2b-${suffix}`, visibility: 'public' },
      });
      expect(createRoom.status()).toBe(200);
      const {
        data: { room },
      } = (await createRoom.json()) as { data: { room: { chatId: string } } };

      // No messages posted — head is 0. Client reporting 0 is in sync.
      const cookie = cookieHeaderFromSetCookie(ownerSession.response);
      const ws = await connectWebSocket({ cookieHeader: cookie });
      try {
        ws.send({
          id: 'sync-2',
          type: 'sync.request',
          payload: {
            chats: [
              {
                chatId: room.chatId,
                lastKnownContiguousSequence: 0,
                lastKnownReadSequence: 0,
              },
            ],
          },
        });
        const evt = (await ws.nextEvent(
          (ev) => ev.type === 'sync.response',
        )) as ReceivedEvent & { payload: SyncResponsePayload };
        const advice = evt.payload.chats[0];
        expect(advice).toBeDefined();
        if (advice === undefined) return;
        expect(advice.advice).toBe('in-sync');
        expect(advice.headSequence).toBe(0);
        expect(advice.rangeHint).toBeUndefined();
      } finally {
        await ws.close();
      }
    } finally {
      await ownerCtx.dispose();
    }
  });

  test('chat-inaccessible advice for unknown or lost-access chat', async () => {
    const suffix = uniqueSuffix();
    const user = {
      email: `rt2c-${suffix}@example.com`,
      username: `rt2c_${suffix}`.replace(/-/g, '_'),
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
    const ctx = await apiRequest.newContext({ baseURL: 'http://localhost:3000' });
    try {
      const session = await register(ctx, user);
      const cookie = cookieHeaderFromSetCookie(session.response);
      const ws = await connectWebSocket({ cookieHeader: cookie });
      try {
        // A UUID that exists nowhere in the DB must come back as
        // chat-inaccessible rather than leaking existence or looping.
        const fakeChatId = '00000000-0000-4000-8000-000000000001';
        ws.send({
          id: 'sync-3',
          type: 'sync.request',
          payload: {
            chats: [
              {
                chatId: fakeChatId,
                lastKnownContiguousSequence: 0,
                lastKnownReadSequence: 0,
              },
            ],
          },
        });
        const evt = (await ws.nextEvent(
          (ev) => ev.type === 'sync.response',
        )) as ReceivedEvent & { payload: SyncResponsePayload };
        const advice = evt.payload.chats[0];
        expect(advice).toBeDefined();
        if (advice === undefined) return;
        expect(advice.advice).toBe('chat-inaccessible');
        expect(advice.headSequence).toBe(0);
      } finally {
        await ws.close();
      }
    } finally {
      await ctx.dispose();
    }
  });
});

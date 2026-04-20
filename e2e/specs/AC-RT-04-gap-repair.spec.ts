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

// AC-RT-04: when a client detects a gap (it expected N+1 but saw N+2, or
// it reconnected with a stale watermark), it must sync before marking
// the chat contiguous again. The server's sync.response carries the
// exact range the client needs to fetch from history, enforcing the
// "authoritative HTTP then resume websocket" order. This spec tests the
// server half: given a client watermark behind head, the advice is
// fetch-history with a rangeHint that covers exactly the gap.
test.describe('AC-RT-04: client repairs sequence gaps via sync', () => {
  test('sync.response rangeHint covers gap when client is behind head', async () => {
    const suffix = uniqueSuffix();
    const owner = {
      email: `rt4-owner-${suffix}@example.com`,
      username: `rt4_owner_${suffix}`.replace(/-/g, '_'),
      password: 'StrongPassword123!',
    };
    const member = {
      email: `rt4-member-${suffix}@example.com`,
      username: `rt4_member_${suffix}`.replace(/-/g, '_'),
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
        data: { name: `rt4-${suffix}`, visibility: 'public' },
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

      // Simulate: owner posts 5 messages; member's client saw only 1
      // and 2 contiguously, then missed 3-5. The watermark they hand
      // the server is 2. Range hint must be 3..5.
      for (let i = 1; i <= 5; i++) {
        const res = await ownerCtx.post(`/chats/${room.chatId}/messages`, {
          headers: csrfHeaders(ownerSession),
          data: { bodyText: `m-${i.toString()}` },
        });
        expect(res.status()).toBe(200);
      }

      const memberCookie = cookieHeaderFromSetCookie(memberSession.response);
      const ws = await connectWebSocket({ cookieHeader: memberCookie });
      try {
        ws.send({
          id: 'cmd-gap',
          type: 'sync.request',
          payload: {
            chats: [
              {
                chatId: room.chatId,
                lastKnownContiguousSequence: 2,
                lastKnownReadSequence: 2,
              },
            ],
          },
        });
        const evt = (await ws.nextEvent(
          (ev) => ev.type === 'sync.response',
        )) as ReceivedEvent & { payload: SyncResponsePayload };
        expect(evt.payload.replyToCommandId).toBe('cmd-gap');
        const advice = evt.payload.chats[0];
        expect(advice).toBeDefined();
        if (advice === undefined) return;
        expect(advice.advice).toBe('fetch-history');
        expect(advice.headSequence).toBe(5);
        expect(advice.rangeHint).toEqual({ fromSequence: 3, toSequence: 5 });
      } finally {
        await ws.close();
      }
    } finally {
      await ownerCtx.dispose();
      await memberCtx.dispose();
    }
  });

  test('oversize sync.request payload rejected with VALIDATION_ERROR', async () => {
    const suffix = uniqueSuffix();
    const user = {
      email: `rt4b-${suffix}@example.com`,
      username: `rt4b_${suffix}`.replace(/-/g, '_'),
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
        // 201 chats in one sync.request — one over the documented cap.
        // Use distinct but well-formed UUIDs; none need to exist, the
        // cap check runs before per-chat access lookups.
        const chats = Array.from({ length: 201 }, (_, idx) => {
          const hex = idx.toString(16).padStart(12, '0');
          return {
            chatId: `00000000-0000-4000-8000-${hex}`,
            lastKnownContiguousSequence: 0,
            lastKnownReadSequence: 0,
          };
        });
        ws.send({
          id: 'cmd-too-big',
          type: 'sync.request',
          payload: { chats },
        });
        const evt = await ws.nextEvent((ev) => ev.type === 'command.error');
        expect(evt.eventId).toBe('cmd-too-big');
        const payload = evt.payload as { code?: string } | undefined;
        expect(payload?.code).toBe('VALIDATION_ERROR');
      } finally {
        await ws.close();
      }
    } finally {
      await ctx.dispose();
    }
  });
});

import { test, expect, request as apiRequest } from '@playwright/test';
import { csrfHeaders, register } from '../utils/auth.js';

function uniqueSuffix(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

type MessageShape = { id: string; sequence: number; bodyText: string | null };

// AC-MSG-07 ("offline recipient sees missed messages after reconnect")
// has no live websocket component in WS-04 — we simulate offline by
// letting one context sit idle while another writes, then re-fetch via
// GET /chats/{id}/messages?afterSequence=N and confirm the missed
// window is retrievable from durable history.
test.describe('AC-MSG-07: offline → miss → catch up via history', () => {
  test('afterSequence returns every message newer than the cursor', async () => {
    const suffix = uniqueSuffix();
    const alice = {
      email: `alice-${suffix}@example.com`,
      username: `alice_${suffix}`.replace(/-/g, '_'),
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
      const session = await register(ctx, alice);
      const createRoom = await ctx.post('/rooms', {
        headers: csrfHeaders(session),
        data: { name: `room-${suffix}`, visibility: 'public' },
      });
      expect(createRoom.status()).toBe(200);
      const {
        data: { room },
      } = (await createRoom.json()) as {
        data: { room: { chatId: string } };
      };

      for (let i = 1; i <= 5; i++) {
        const res = await ctx.post(`/chats/${room.chatId}/messages`, {
          headers: csrfHeaders(session),
          data: { bodyText: `msg-${i.toString()}` },
        });
        expect(res.status()).toBe(200);
      }

      // Client "goes offline" after seeing sequence 2. Three more
      // messages land while they're away.
      const knownCursor = 2;
      for (let i = 6; i <= 8; i++) {
        const res = await ctx.post(`/chats/${room.chatId}/messages`, {
          headers: csrfHeaders(session),
          data: { bodyText: `missed-${i.toString()}` },
        });
        expect(res.status()).toBe(200);
      }

      const catchup = await ctx.get(
        `/chats/${room.chatId}/messages?afterSequence=${knownCursor.toString()}`,
      );
      expect(catchup.status()).toBe(200);
      const body = (await catchup.json()) as {
        data: { headSequence: number; messages: MessageShape[] };
      };
      expect(body.data.headSequence).toBe(8);
      const sequences = body.data.messages.map((m) => m.sequence).sort((a, b) => a - b);
      expect(sequences).toEqual([3, 4, 5, 6, 7, 8]);
    } finally {
      await ctx.dispose();
    }
  });
});

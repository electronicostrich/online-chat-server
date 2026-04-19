import { test, expect, request as apiRequest } from '@playwright/test';
import { csrfHeaders, register } from '../utils/auth.js';

function uniqueSuffix(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

type MessageShape = { sequence: number; bodyText: string | null };

// AC-MSG-08: `beforeSequence` walks back through history without
// replacing newer-loaded messages. We send 25 messages, then page
// backwards with `limit=10` twice and confirm the returned windows
// don't overlap.
test.describe('AC-MSG-08: infinite scroll via beforeSequence + limit', () => {
  test('beforeSequence returns older-than-cursor messages; non-overlapping pages', async () => {
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

      const N = 25;
      for (let i = 1; i <= N; i++) {
        const res = await ctx.post(`/chats/${room.chatId}/messages`, {
          headers: csrfHeaders(session),
          data: { bodyText: `msg-${i.toString().padStart(2, '0')}` },
        });
        expect(res.status()).toBe(200);
      }

      const pageSize = 10;
      // First page: latest 10 (sequences 25..16, DESC)
      const page1 = await ctx.get(`/chats/${room.chatId}/messages?limit=${pageSize.toString()}`);
      expect(page1.status()).toBe(200);
      const p1 = (await page1.json()) as {
        data: { headSequence: number; messages: MessageShape[] };
      };
      expect(p1.data.headSequence).toBe(N);
      const p1Sequences = p1.data.messages.map((m) => m.sequence);
      expect(p1Sequences).toEqual([25, 24, 23, 22, 21, 20, 19, 18, 17, 16]);

      const firstOldestInPage1 = p1Sequences[p1Sequences.length - 1];
      if (firstOldestInPage1 === undefined) {
        throw new Error('page1 is empty');
      }

      // Second page: older than 16 — should be 15..6.
      const page2 = await ctx.get(
        `/chats/${room.chatId}/messages?beforeSequence=${firstOldestInPage1.toString()}&limit=${pageSize.toString()}`,
      );
      expect(page2.status()).toBe(200);
      const p2 = (await page2.json()) as {
        data: { messages: MessageShape[] };
      };
      const p2Sequences = p2.data.messages.map((m) => m.sequence);
      expect(p2Sequences).toEqual([15, 14, 13, 12, 11, 10, 9, 8, 7, 6]);

      // Non-overlap invariant: the two windows share no sequence
      // numbers.
      const overlap = p1Sequences.filter((s) => p2Sequences.includes(s));
      expect(overlap).toEqual([]);

      // Third page: reach the tail.
      const page3 = await ctx.get(
        `/chats/${room.chatId}/messages?beforeSequence=6&limit=${pageSize.toString()}`,
      );
      expect(page3.status()).toBe(200);
      const p3 = (await page3.json()) as {
        data: { messages: MessageShape[] };
      };
      const p3Sequences = p3.data.messages.map((m) => m.sequence);
      expect(p3Sequences).toEqual([5, 4, 3, 2, 1]);
    } finally {
      await ctx.dispose();
    }
  });
});

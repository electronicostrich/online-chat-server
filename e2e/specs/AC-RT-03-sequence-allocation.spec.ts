import { test, expect, request as apiRequest } from '@playwright/test';
import { csrfHeaders, register } from '../utils/auth.js';

function uniqueSuffix(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

// AC-RT-03: "Every persisted message gets the next chat-local sequence".
// The sequence is incremented atomically by the send-message transaction,
// so concurrent sends produce a contiguous block with no duplicates and
// no gaps — proven here by firing N parallel sends and inspecting the
// resulting set of allocated sequences.
test.describe('AC-RT-03: chat-local sequence allocation', () => {
  test('concurrent sends receive unique, contiguous sequences starting at 1', async () => {
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

      const N = 10;
      const sends = Array.from({ length: N }, (_unused, i) =>
        ctx.post(`/chats/${room.chatId}/messages`, {
          headers: csrfHeaders(session),
          data: { bodyText: `concurrent-${i.toString()}` },
        }),
      );
      const results = await Promise.all(sends);
      const sequences: number[] = [];
      for (const res of results) {
        expect(res.status()).toBe(200);
        const body = (await res.json()) as { data: { message: { sequence: number } } };
        sequences.push(body.data.message.sequence);
      }
      const sorted = [...sequences].sort((a, b) => a - b);
      expect(new Set(sorted).size).toBe(N);
      expect(sorted).toEqual(Array.from({ length: N }, (_unused, i) => i + 1));

      // History confirms the head sequence landed at N.
      const history = await ctx.get(`/chats/${room.chatId}/messages`);
      expect(history.status()).toBe(200);
      const hbody = (await history.json()) as {
        data: { headSequence: number; messages: { sequence: number }[] };
      };
      expect(hbody.data.headSequence).toBe(N);
      expect(hbody.data.messages[0]?.sequence).toBe(N);
    } finally {
      await ctx.dispose();
    }
  });
});

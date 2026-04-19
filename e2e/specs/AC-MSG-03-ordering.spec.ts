import { test, expect, request as apiRequest } from '@playwright/test';
import { csrfHeaders, register } from '../utils/auth.js';

function uniqueSuffix(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

type MessageShape = {
  id: string;
  sequence: number;
  bodyText: string | null;
  createdAt: string;
};

test.describe('AC-MSG-03: stable chronological ordering', () => {
  test('history reports messages in descending sequence with monotonically increasing createdAt', async () => {
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

      // Send 5 messages serially. Serial sends guarantee createdAt is
      // chronological; we validate that history mirrors the insertion order
      // without any gaps in sequence numbers.
      const bodies = ['first', 'second', 'third', 'fourth', 'fifth'];
      for (const body of bodies) {
        const res = await ctx.post(`/chats/${room.chatId}/messages`, {
          headers: csrfHeaders(session),
          data: { bodyText: body },
        });
        expect(res.status()).toBe(200);
      }

      const history = await ctx.get(`/chats/${room.chatId}/messages`);
      expect(history.status()).toBe(200);
      const body = (await history.json()) as {
        data: {
          chatId: string;
          headSequence: number;
          messages: MessageShape[];
        };
      };
      expect(body.data.chatId).toBe(room.chatId);
      expect(body.data.headSequence).toBe(5);
      expect(body.data.messages).toHaveLength(5);
      // DESC order — newest first.
      const sequences = body.data.messages.map((m) => m.sequence);
      expect(sequences).toEqual([5, 4, 3, 2, 1]);
      // createdAt monotonically non-decreasing when read oldest → newest.
      const oldestFirst = [...body.data.messages].reverse();
      for (let i = 1; i < oldestFirst.length; i++) {
        const prev = oldestFirst[i - 1];
        const cur = oldestFirst[i];
        if (prev === undefined || cur === undefined) continue;
        expect(new Date(cur.createdAt).getTime()).toBeGreaterThanOrEqual(
          new Date(prev.createdAt).getTime(),
        );
      }
      // Body-text ordering mirrors insertion order (oldest → newest).
      expect(oldestFirst.map((m) => m.bodyText)).toEqual(bodies);
    } finally {
      await ctx.dispose();
    }
  });
});

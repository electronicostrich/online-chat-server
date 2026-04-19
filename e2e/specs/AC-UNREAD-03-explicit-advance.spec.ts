import { test, expect, request as apiRequest } from '@playwright/test';
import { csrfHeaders, register } from '../utils/auth.js';

function uniqueSuffix(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

// AC-UNREAD-03: POST /chats/{id}/read moves the server-side
// last_read_sequence forward; the server clamps over-advances to head
// without error.
test.describe('AC-UNREAD-03: explicit read-state advance', () => {
  test('advance sets lastReadSequence; clamps over-advance to head', async () => {
    const suffix = uniqueSuffix();
    const owner = {
      email: `owner-${suffix}@example.com`,
      username: `owner_${suffix}`.replace(/-/g, '_'),
      password: 'StrongPassword123!',
    };
    const reader = {
      email: `reader-${suffix}@example.com`,
      username: `reader_${suffix}`.replace(/-/g, '_'),
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
    const readerCtx = await apiRequest.newContext({ baseURL: 'http://localhost:3000' });
    try {
      const ownerSession = await register(ownerCtx, owner);
      const readerSession = await register(readerCtx, reader);

      const createRoom = await ownerCtx.post('/rooms', {
        headers: csrfHeaders(ownerSession),
        data: { name: `room-${suffix}`, visibility: 'public' },
      });
      expect(createRoom.status()).toBe(200);
      const {
        data: { room },
      } = (await createRoom.json()) as {
        data: { room: { chatId: string } };
      };

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

      for (let i = 1; i <= 4; i++) {
        const res = await ownerCtx.post(`/chats/${room.chatId}/messages`, {
          headers: csrfHeaders(ownerSession),
          data: { bodyText: `msg-${i.toString()}` },
        });
        expect(res.status()).toBe(200);
      }

      // Reader advances to sequence 4 (the current head).
      const advance = await readerCtx.post(`/chats/${room.chatId}/read`, {
        headers: csrfHeaders(readerSession),
        data: { readUpToSequence: 4 },
      });
      expect(advance.status()).toBe(200);
      const body = (await advance.json()) as {
        data: { chatId: string; lastReadSequence: number };
      };
      expect(body.data.chatId).toBe(room.chatId);
      expect(body.data.lastReadSequence).toBe(4);

      const after = await readerCtx.get(`/chats/${room.chatId}/read-state`);
      expect(after.status()).toBe(200);
      const afterBody = (await after.json()) as {
        data: { lastReadSequence: number; headSequence: number; hasUnread: boolean };
      };
      expect(afterBody.data.lastReadSequence).toBe(4);
      expect(afterBody.data.hasUnread).toBe(false);

      // Over-advance is silently clamped to head, not rejected.
      const over = await readerCtx.post(`/chats/${room.chatId}/read`, {
        headers: csrfHeaders(readerSession),
        data: { readUpToSequence: 10_000 },
      });
      expect(over.status()).toBe(200);
      const overBody = (await over.json()) as {
        data: { lastReadSequence: number };
      };
      expect(overBody.data.lastReadSequence).toBe(4);

      // Monotonicity: a caller cannot move last_read_sequence backwards
      // (the server uses GREATEST). Another advance at 2 leaves
      // lastReadSequence at 4.
      const back = await readerCtx.post(`/chats/${room.chatId}/read`, {
        headers: csrfHeaders(readerSession),
        data: { readUpToSequence: 2 },
      });
      expect(back.status()).toBe(200);
      const backBody = (await back.json()) as {
        data: { lastReadSequence: number };
      };
      expect(backBody.data.lastReadSequence).toBe(4);
    } finally {
      await ownerCtx.dispose();
      await readerCtx.dispose();
    }
  });
});

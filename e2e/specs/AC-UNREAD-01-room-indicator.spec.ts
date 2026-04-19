import { test, expect, request as apiRequest } from '@playwright/test';
import { csrfHeaders, register } from '../utils/auth.js';

function uniqueSuffix(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

// AC-UNREAD-01: an empty read-state row (never-opened) plus an
// existing message produces hasUnread=true. After advancing read-state
// to head, hasUnread flips to false.
test.describe('AC-UNREAD-01: room unread indicator', () => {
  test('never-opened chat with messages reports hasUnread=true', async () => {
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
      await register(readerCtx, reader);

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

      // Owner posts 3 messages. Reader never opens the chat yet.
      for (let i = 1; i <= 3; i++) {
        const res = await ownerCtx.post(`/chats/${room.chatId}/messages`, {
          headers: csrfHeaders(ownerSession),
          data: { bodyText: `msg-${i.toString()}` },
        });
        expect(res.status()).toBe(200);
      }

      const readerState = await readerCtx.get(`/chats/${room.chatId}/read-state`);
      expect(readerState.status()).toBe(200);
      const rs = (await readerState.json()) as {
        data: {
          lastReadSequence: number;
          headSequence: number;
          hasUnread: boolean;
        };
      };
      expect(rs.data.lastReadSequence).toBe(0);
      expect(rs.data.headSequence).toBe(3);
      expect(rs.data.hasUnread).toBe(true);
    } finally {
      await ownerCtx.dispose();
      await readerCtx.dispose();
    }
  });
});

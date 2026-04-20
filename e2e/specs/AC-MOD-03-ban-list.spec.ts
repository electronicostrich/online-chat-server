import { test, expect, request as apiRequest } from '@playwright/test';
import { csrfHeaders, register } from '../utils/auth.js';

function uniqueSuffix(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

type CreateRoomResponse = { data: { room: { chatId: string } } };
type BansResponse = {
  data: {
    bans: Array<{
      userId: string;
      username: string;
      bannedByUserId: string | null;
      bannedByUsername: string | null;
      createdAt: string;
    }>;
  };
};

test.describe('AC-MOD-03: admin views the room ban list', () => {
  test('ban list shows banned users and who issued each ban', async () => {
    const suffix = uniqueSuffix();
    const alice = {
      email: `alice-${suffix}@example.com`,
      username: `alice_${suffix}`.replace(/-/g, '_'),
      password: 'StrongPassword123!',
    };
    const mallory = {
      email: `mallory-${suffix}@example.com`,
      username: `mallory_${suffix}`.replace(/-/g, '_'),
      password: 'StrongPassword123!',
    };

    const seed = await apiRequest.newContext({ baseURL: 'http://localhost:3000' });
    try {
      const res = await seed.post('/__test/seed', { data: { strategy: 'truncate' } });
      expect(res.status()).toBe(200);
    } finally {
      await seed.dispose();
    }

    const aliceCtx = await apiRequest.newContext({ baseURL: 'http://localhost:3000' });
    const malloryCtx = await apiRequest.newContext({ baseURL: 'http://localhost:3000' });
    try {
      const aliceSession = await register(aliceCtx, alice);
      const mallorySession = await register(malloryCtx, mallory);

      const created = await aliceCtx.post('/rooms', {
        headers: csrfHeaders(aliceSession),
        data: { name: `open-${suffix}`, visibility: 'public' },
      });
      expect(created.status()).toBe(200);
      const { data: { room } } = (await created.json()) as CreateRoomResponse;

      await malloryCtx.post(`/rooms/${room.chatId}/join`, {
        headers: csrfHeaders(mallorySession),
      });

      await aliceCtx.post(
        `/rooms/${room.chatId}/members/${mallorySession.userId}/remove`,
        { headers: csrfHeaders(aliceSession) },
      );

      // Admin sees the banned entry with the actor metadata.
      const listRes = await aliceCtx.get(`/rooms/${room.chatId}/bans`, {
        headers: csrfHeaders(aliceSession),
      });
      expect(listRes.status()).toBe(200);
      const body = (await listRes.json()) as BansResponse;
      const entry = body.data.bans.find((b) => b.userId === mallorySession.userId);
      expect(entry).toBeDefined();
      expect(entry?.username).toBe(mallory.username);
      expect(entry?.bannedByUserId).toBe(aliceSession.userId);
      expect(entry?.bannedByUsername).toBe(alice.username);

      // Non-admin callers cannot access the ban list — even an ex-member
      // who was banned from the room shouldn't see it.
      const forbidden = await malloryCtx.get(`/rooms/${room.chatId}/bans`, {
        headers: csrfHeaders(mallorySession),
      });
      // Mallory was removed so she's no longer a member; spec allows
      // either NOT_A_MEMBER (403) or a missing-member rejection.
      expect([403, 404]).toContain(forbidden.status());
    } finally {
      await aliceCtx.dispose();
      await malloryCtx.dispose();
    }
  });
});

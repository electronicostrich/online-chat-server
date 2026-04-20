import { test, expect, request as apiRequest } from '@playwright/test';
import { csrfHeaders, register } from '../utils/auth.js';

function uniqueSuffix(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

type CreateRoomResponse = { data: { room: { chatId: string } } };
type ErrorResponse = { error: { code: string; message: string } };
type BansResponse = {
  data: {
    bans: Array<{
      userId: string;
      username: string;
      bannedByUserId: string | null;
    }>;
  };
};

test.describe('AC-MOD-02: admin removes a member, removal is also a ban', () => {
  test('remove → not a member; also appears on ban list; cannot rejoin', async () => {
    const suffix = uniqueSuffix();
    const alice = {
      email: `alice-${suffix}@example.com`,
      username: `alice_${suffix}`.replace(/-/g, '_'),
      password: 'StrongPassword123!',
    };
    const eve = {
      email: `eve-${suffix}@example.com`,
      username: `eve_${suffix}`.replace(/-/g, '_'),
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
    const eveCtx = await apiRequest.newContext({ baseURL: 'http://localhost:3000' });
    try {
      const aliceSession = await register(aliceCtx, alice);
      const eveSession = await register(eveCtx, eve);

      const created = await aliceCtx.post('/rooms', {
        headers: csrfHeaders(aliceSession),
        data: { name: `open-${suffix}`, visibility: 'public' },
      });
      expect(created.status()).toBe(200);
      const { data: { room } } = (await created.json()) as CreateRoomResponse;

      await eveCtx.post(`/rooms/${room.chatId}/join`, {
        headers: csrfHeaders(eveSession),
      });

      // Non-admin cannot remove.
      const forbidden = await eveCtx.post(
        `/rooms/${room.chatId}/members/${aliceSession.userId}/remove`,
        { headers: csrfHeaders(eveSession) },
      );
      expect(forbidden.status()).toBe(403);
      const forbiddenBody = (await forbidden.json()) as ErrorResponse;
      expect(forbiddenBody.error.code).toBe('FORBIDDEN');

      // Admin (owner) removes Eve.
      const removeRes = await aliceCtx.post(
        `/rooms/${room.chatId}/members/${eveSession.userId}/remove`,
        { headers: csrfHeaders(aliceSession) },
      );
      expect(removeRes.status()).toBe(200);

      // Eve appears on the room's ban list; the actor is Alice.
      const banList = await aliceCtx.get(`/rooms/${room.chatId}/bans`, {
        headers: csrfHeaders(aliceSession),
      });
      expect(banList.status()).toBe(200);
      const bans = (await banList.json()) as BansResponse;
      const row = bans.data.bans.find((b) => b.userId === eveSession.userId);
      expect(row).toBeDefined();
      expect(row?.bannedByUserId).toBe(aliceSession.userId);

      // Eve cannot rejoin.
      const rejoin = await eveCtx.post(`/rooms/${room.chatId}/join`, {
        headers: csrfHeaders(eveSession),
      });
      expect(rejoin.status()).toBe(403);
      const rejoinBody = (await rejoin.json()) as ErrorResponse;
      expect(rejoinBody.error.code).toBe('ROOM_BANNED');

      // Owner cannot be removed (AC-MOD-07 invariant via remove path).
      const ownerRemove = await aliceCtx.post(
        `/rooms/${room.chatId}/members/${aliceSession.userId}/remove`,
        { headers: csrfHeaders(aliceSession) },
      );
      expect([400, 403]).toContain(ownerRemove.status());
    } finally {
      await aliceCtx.dispose();
      await eveCtx.dispose();
    }
  });
});

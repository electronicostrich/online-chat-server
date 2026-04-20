import { test, expect, request as apiRequest } from '@playwright/test';
import { csrfHeaders, register } from '../utils/auth.js';

function uniqueSuffix(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

type CreateRoomResponse = { data: { room: { chatId: string } } };
type ErrorResponse = { error: { code: string; message: string } };

test.describe('AC-ROOM-06: banned users cannot join public rooms', () => {
  test('a user who has been banned is rejected from /join with ROOM_BANNED', async () => {
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

      // Eve joins first.
      const joinRes = await eveCtx.post(`/rooms/${room.chatId}/join`, {
        headers: csrfHeaders(eveSession),
      });
      expect(joinRes.status()).toBe(200);

      // Alice (owner) removes Eve — remove-is-ban per AC-MOD-02.
      const removeRes = await aliceCtx.post(
        `/rooms/${room.chatId}/members/${eveSession.userId}/remove`,
        { headers: csrfHeaders(aliceSession) },
      );
      expect(removeRes.status()).toBe(200);

      // Eve can no longer join.
      const rejoin = await eveCtx.post(`/rooms/${room.chatId}/join`, {
        headers: csrfHeaders(eveSession),
      });
      expect(rejoin.status()).toBe(403);
      const body = (await rejoin.json()) as ErrorResponse;
      expect(body.error.code).toBe('ROOM_BANNED');
    } finally {
      await aliceCtx.dispose();
      await eveCtx.dispose();
    }
  });
});

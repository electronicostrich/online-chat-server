import { test, expect, request as apiRequest } from '@playwright/test';
import { csrfHeaders, register } from '../utils/auth.js';

function uniqueSuffix(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

type CreateRoomResponse = { data: { room: { chatId: string } } };
type BansResponse = {
  data: {
    bans: Array<{ userId: string }>;
  };
};

test.describe('AC-MOD-04: admin unbans a user', () => {
  test('unban removes the ban row and the user can rejoin', async () => {
    const suffix = uniqueSuffix();
    const alice = {
      email: `alice-${suffix}@example.com`,
      username: `alice_${suffix}`.replace(/-/g, '_'),
      password: 'StrongPassword123!',
    };
    const bob = {
      email: `bob-${suffix}@example.com`,
      username: `bob_${suffix}`.replace(/-/g, '_'),
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
    const bobCtx = await apiRequest.newContext({ baseURL: 'http://localhost:3000' });
    try {
      const aliceSession = await register(aliceCtx, alice);
      const bobSession = await register(bobCtx, bob);

      const created = await aliceCtx.post('/rooms', {
        headers: csrfHeaders(aliceSession),
        data: { name: `open-${suffix}`, visibility: 'public' },
      });
      expect(created.status()).toBe(200);
      const { data: { room } } = (await created.json()) as CreateRoomResponse;

      // Bob joins then Alice bans him.
      await bobCtx.post(`/rooms/${room.chatId}/join`, {
        headers: csrfHeaders(bobSession),
      });
      await aliceCtx.post(
        `/rooms/${room.chatId}/members/${bobSession.userId}/remove`,
        { headers: csrfHeaders(aliceSession) },
      );

      // Unban.
      const unban = await aliceCtx.delete(
        `/rooms/${room.chatId}/bans/${bobSession.userId}`,
        { headers: csrfHeaders(aliceSession) },
      );
      expect(unban.status()).toBe(200);

      // Ban list no longer contains Bob.
      const bans = (await (
        await aliceCtx.get(`/rooms/${room.chatId}/bans`, {
          headers: csrfHeaders(aliceSession),
        })
      ).json()) as BansResponse;
      const present = bans.data.bans.some((b) => b.userId === bobSession.userId);
      expect(present).toBe(false);

      // Bob can rejoin successfully.
      const rejoin = await bobCtx.post(`/rooms/${room.chatId}/join`, {
        headers: csrfHeaders(bobSession),
      });
      expect(rejoin.status()).toBe(200);

      // Unbanning a user who isn't actually banned returns 404.
      const notBanned = await aliceCtx.delete(
        `/rooms/${room.chatId}/bans/${bobSession.userId}`,
        { headers: csrfHeaders(aliceSession) },
      );
      expect(notBanned.status()).toBe(404);
    } finally {
      await aliceCtx.dispose();
      await bobCtx.dispose();
    }
  });
});

import { test, expect, request as apiRequest } from '@playwright/test';
import { csrfHeaders, register } from '../utils/auth.js';

function uniqueSuffix(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

type CreateRoomResponse = { data: { room: { chatId: string } } };

test.describe('AC-MOD-06: owner can remove any admin', () => {
  test("owner strips a promoted admin's status", async () => {
    const suffix = uniqueSuffix();
    const owner = {
      email: `owner-${suffix}@example.com`,
      username: `owner_${suffix}`.replace(/-/g, '_'),
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

    const ownerCtx = await apiRequest.newContext({ baseURL: 'http://localhost:3000' });
    const bobCtx = await apiRequest.newContext({ baseURL: 'http://localhost:3000' });
    try {
      const ownerSession = await register(ownerCtx, owner);
      const bobSession = await register(bobCtx, bob);

      const created = await ownerCtx.post('/rooms', {
        headers: csrfHeaders(ownerSession),
        data: { name: `open-${suffix}`, visibility: 'public' },
      });
      expect(created.status()).toBe(200);
      const { data: { room } } = (await created.json()) as CreateRoomResponse;

      await bobCtx.post(`/rooms/${room.chatId}/join`, {
        headers: csrfHeaders(bobSession),
      });
      const promote = await ownerCtx.post(
        `/rooms/${room.chatId}/members/${bobSession.userId}/make-admin`,
        { headers: csrfHeaders(ownerSession) },
      );
      expect(promote.status()).toBe(200);

      // Bob (now admin) can view the ban list.
      expect(
        (
          await bobCtx.get(`/rooms/${room.chatId}/bans`, {
            headers: csrfHeaders(bobSession),
          })
        ).status(),
      ).toBe(200);

      // Owner removes Bob's admin role.
      const strip = await ownerCtx.post(
        `/rooms/${room.chatId}/members/${bobSession.userId}/remove-admin`,
        { headers: csrfHeaders(ownerSession) },
      );
      expect(strip.status()).toBe(200);

      // Admin-only actions are now rejected for Bob.
      expect(
        (
          await bobCtx.get(`/rooms/${room.chatId}/bans`, {
            headers: csrfHeaders(bobSession),
          })
        ).status(),
      ).toBe(403);
    } finally {
      await ownerCtx.dispose();
      await bobCtx.dispose();
    }
  });
});

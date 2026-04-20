import { test, expect, request as apiRequest } from '@playwright/test';
import { csrfHeaders, register } from '../utils/auth.js';

function uniqueSuffix(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

type CreateRoomResponse = { data: { room: { chatId: string } } };

test.describe('AC-MOD-05: admin can remove another non-owner admin', () => {
  test("non-owner admin's admin status can be stripped by another admin", async () => {
    const suffix = uniqueSuffix();
    const owner = {
      email: `owner-${suffix}@example.com`,
      username: `owner_${suffix}`.replace(/-/g, '_'),
      password: 'StrongPassword123!',
    };
    const adminA = {
      email: `admina-${suffix}@example.com`,
      username: `admina_${suffix}`.replace(/-/g, '_'),
      password: 'StrongPassword123!',
    };
    const adminB = {
      email: `adminb-${suffix}@example.com`,
      username: `adminb_${suffix}`.replace(/-/g, '_'),
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
    const aCtx = await apiRequest.newContext({ baseURL: 'http://localhost:3000' });
    const bCtx = await apiRequest.newContext({ baseURL: 'http://localhost:3000' });
    try {
      const ownerSession = await register(ownerCtx, owner);
      const aSession = await register(aCtx, adminA);
      const bSession = await register(bCtx, adminB);

      const created = await ownerCtx.post('/rooms', {
        headers: csrfHeaders(ownerSession),
        data: { name: `open-${suffix}`, visibility: 'public' },
      });
      expect(created.status()).toBe(200);
      const { data: { room } } = (await created.json()) as CreateRoomResponse;

      await aCtx.post(`/rooms/${room.chatId}/join`, {
        headers: csrfHeaders(aSession),
      });
      await bCtx.post(`/rooms/${room.chatId}/join`, {
        headers: csrfHeaders(bSession),
      });

      // Owner promotes both to admin.
      for (const userId of [aSession.userId, bSession.userId]) {
        const promote = await ownerCtx.post(
          `/rooms/${room.chatId}/members/${userId}/make-admin`,
          { headers: csrfHeaders(ownerSession) },
        );
        expect(promote.status()).toBe(200);
      }

      // Admin A removes admin B's admin status.
      const strip = await aCtx.post(
        `/rooms/${room.chatId}/members/${bSession.userId}/remove-admin`,
        { headers: csrfHeaders(aSession) },
      );
      expect(strip.status()).toBe(200);

      // B's subsequent admin-only action (listing bans) fails because
      // she's back to `member`.
      const bansAttempt = await bCtx.get(`/rooms/${room.chatId}/bans`, {
        headers: csrfHeaders(bSession),
      });
      expect(bansAttempt.status()).toBe(403);
    } finally {
      await ownerCtx.dispose();
      await aCtx.dispose();
      await bCtx.dispose();
    }
  });
});

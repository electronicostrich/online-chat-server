import { test, expect, request as apiRequest } from '@playwright/test';
import { csrfHeaders, register } from '../utils/auth.js';

function uniqueSuffix(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

type CreateRoomResponse = { data: { room: { chatId: string } } };
type ErrorResponse = { error: { code: string; message: string } };

test.describe('AC-MOD-07: owner admin status cannot be stripped', () => {
  test('every caller (owner, admin, member) is rejected with FORBIDDEN', async () => {
    const suffix = uniqueSuffix();
    const owner = {
      email: `owner-${suffix}@example.com`,
      username: `owner_${suffix}`.replace(/-/g, '_'),
      password: 'StrongPassword123!',
    };
    const admin = {
      email: `admin-${suffix}@example.com`,
      username: `admin_${suffix}`.replace(/-/g, '_'),
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
    const adminCtx = await apiRequest.newContext({ baseURL: 'http://localhost:3000' });
    try {
      const ownerSession = await register(ownerCtx, owner);
      const adminSession = await register(adminCtx, admin);

      const created = await ownerCtx.post('/rooms', {
        headers: csrfHeaders(ownerSession),
        data: { name: `open-${suffix}`, visibility: 'public' },
      });
      expect(created.status()).toBe(200);
      const { data: { room } } = (await created.json()) as CreateRoomResponse;

      await adminCtx.post(`/rooms/${room.chatId}/join`, {
        headers: csrfHeaders(adminSession),
      });
      const promote = await ownerCtx.post(
        `/rooms/${room.chatId}/members/${adminSession.userId}/make-admin`,
        { headers: csrfHeaders(ownerSession) },
      );
      expect(promote.status()).toBe(200);

      // The promoted admin cannot strip the owner.
      const adminStrip = await adminCtx.post(
        `/rooms/${room.chatId}/members/${ownerSession.userId}/remove-admin`,
        { headers: csrfHeaders(adminSession) },
      );
      expect(adminStrip.status()).toBe(403);
      const adminBody = (await adminStrip.json()) as ErrorResponse;
      expect(adminBody.error.code).toBe('FORBIDDEN');

      // Even the owner cannot strip their own admin status.
      const selfStrip = await ownerCtx.post(
        `/rooms/${room.chatId}/members/${ownerSession.userId}/remove-admin`,
        { headers: csrfHeaders(ownerSession) },
      );
      expect(selfStrip.status()).toBe(403);
    } finally {
      await ownerCtx.dispose();
      await adminCtx.dispose();
    }
  });
});

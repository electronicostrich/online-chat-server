import { test, expect, request as apiRequest } from '@playwright/test';
import { csrfHeaders, register } from '../utils/auth.js';

function uniqueSuffix(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

type CreateRoomResponse = { data: { room: { chatId: string } } };
type ErrorResponse = { error: { code: string; message: string } };

test.describe('AC-MOD-08: admin promotes member to admin', () => {
  test('role transitions member → admin; non-admin caller rejected; non-member target rejected', async () => {
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
    const carol = {
      email: `carol-${suffix}@example.com`,
      username: `carol_${suffix}`.replace(/-/g, '_'),
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
    const carolCtx = await apiRequest.newContext({ baseURL: 'http://localhost:3000' });
    try {
      const ownerSession = await register(ownerCtx, owner);
      const bobSession = await register(bobCtx, bob);
      const carolSession = await register(carolCtx, carol);

      const created = await ownerCtx.post('/rooms', {
        headers: csrfHeaders(ownerSession),
        data: { name: `open-${suffix}`, visibility: 'public' },
      });
      expect(created.status()).toBe(200);
      const { data: { room } } = (await created.json()) as CreateRoomResponse;

      await bobCtx.post(`/rooms/${room.chatId}/join`, {
        headers: csrfHeaders(bobSession),
      });

      // Non-admin caller cannot promote.
      const nonAdminPromote = await bobCtx.post(
        `/rooms/${room.chatId}/members/${bobSession.userId}/make-admin`,
        { headers: csrfHeaders(bobSession) },
      );
      expect(nonAdminPromote.status()).toBe(403);

      // Owner promotes Bob to admin.
      const promote = await ownerCtx.post(
        `/rooms/${room.chatId}/members/${bobSession.userId}/make-admin`,
        { headers: csrfHeaders(ownerSession) },
      );
      expect(promote.status()).toBe(200);

      // Re-promotion is idempotent.
      const again = await ownerCtx.post(
        `/rooms/${room.chatId}/members/${bobSession.userId}/make-admin`,
        { headers: csrfHeaders(ownerSession) },
      );
      expect(again.status()).toBe(200);

      // Bob can now perform admin-only actions (ban list).
      const asBob = await bobCtx.get(`/rooms/${room.chatId}/bans`, {
        headers: csrfHeaders(bobSession),
      });
      expect(asBob.status()).toBe(200);

      // Carol never joined the room → promotion rejected with NOT_A_MEMBER.
      const notMember = await ownerCtx.post(
        `/rooms/${room.chatId}/members/${carolSession.userId}/make-admin`,
        { headers: csrfHeaders(ownerSession) },
      );
      expect(notMember.status()).toBe(403);
      const body = (await notMember.json()) as ErrorResponse;
      expect(body.error.code).toBe('NOT_A_MEMBER');
    } finally {
      await ownerCtx.dispose();
      await bobCtx.dispose();
      await carolCtx.dispose();
    }
  });
});

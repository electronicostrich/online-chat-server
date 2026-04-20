import { test, expect, request as apiRequest } from '@playwright/test';
import { csrfHeaders, register } from '../utils/auth.js';

function uniqueSuffix(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

type CreateRoomResponse = { data: { room: { chatId: string } } };
type ErrorResponse = { error: { code: string; message: string } };

test.describe('AC-MOD-01: owner is always admin', () => {
  test('owner cannot be demoted and cannot be removed', async () => {
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

      // Owner cannot be promoted via make-admin (already admin-equivalent).
      const selfPromote = await aliceCtx.post(
        `/rooms/${room.chatId}/members/${aliceSession.userId}/make-admin`,
        { headers: csrfHeaders(aliceSession) },
      );
      expect(selfPromote.status()).toBe(400);
      const spBody = (await selfPromote.json()) as ErrorResponse;
      expect(spBody.error.code).toBe('VALIDATION_ERROR');

      // Owner cannot have admin stripped — AC-MOD-07 covers the same
      // invariant from the remove-admin direction.
      const strip = await aliceCtx.post(
        `/rooms/${room.chatId}/members/${aliceSession.userId}/remove-admin`,
        { headers: csrfHeaders(aliceSession) },
      );
      expect(strip.status()).toBe(403);
      const stripBody = (await strip.json()) as ErrorResponse;
      expect(stripBody.error.code).toBe('FORBIDDEN');

      // Bob (a regular member) also cannot strip the owner.
      await bobCtx.post(`/rooms/${room.chatId}/join`, {
        headers: csrfHeaders(bobSession),
      });
      const bobStrip = await bobCtx.post(
        `/rooms/${room.chatId}/members/${aliceSession.userId}/remove-admin`,
        { headers: csrfHeaders(bobSession) },
      );
      expect(bobStrip.status()).toBe(403);
    } finally {
      await aliceCtx.dispose();
      await bobCtx.dispose();
    }
  });
});

import { test, expect, request as apiRequest } from '@playwright/test';
import { csrfHeaders, register } from '../utils/auth.js';

function uniqueSuffix(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

type CreateRoomResponse = { data: { room: { chatId: string } } };
type ErrorResponse = { error: { code: string; message: string } };

test.describe('AC-ROOM-07: owner cannot leave their own room', () => {
  test('owner /leave is rejected with FORBIDDEN; non-owner /leave succeeds', async () => {
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

      // Bob joins so we can verify non-owner leave works normally.
      const bobJoin = await bobCtx.post(`/rooms/${room.chatId}/join`, {
        headers: csrfHeaders(bobSession),
      });
      expect(bobJoin.status()).toBe(200);

      // AC-ROOM-07: owner cannot leave.
      const aliceLeave = await aliceCtx.post(`/rooms/${room.chatId}/leave`, {
        headers: csrfHeaders(aliceSession),
      });
      expect(aliceLeave.status()).toBe(403);
      const aliceBody = (await aliceLeave.json()) as ErrorResponse;
      expect(aliceBody.error.code).toBe('FORBIDDEN');

      // Non-owner can leave cleanly.
      const bobLeave = await bobCtx.post(`/rooms/${room.chatId}/leave`, {
        headers: csrfHeaders(bobSession),
      });
      expect(bobLeave.status()).toBe(200);
    } finally {
      await aliceCtx.dispose();
      await bobCtx.dispose();
    }
  });
});

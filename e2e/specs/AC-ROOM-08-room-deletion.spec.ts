import { test, expect, request as apiRequest } from '@playwright/test';
import { csrfHeaders, register } from '../utils/auth.js';

function uniqueSuffix(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

type CreateRoomResponse = {
  data: { room: { chatId: string } };
};

type ErrorResponse = {
  error: { code: string; message: string };
};

test.describe('AC-ROOM-08: owner deletes their room', () => {
  test('owner can delete; non-owner cannot; double-delete returns 404', async () => {
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
      const res = await seed.post('/__test/seed', {
        data: { strategy: 'truncate' },
      });
      expect(res.status()).toBe(200);
    } finally {
      await seed.dispose();
    }

    const aliceCtx = await apiRequest.newContext({ baseURL: 'http://localhost:3000' });
    const malloryCtx = await apiRequest.newContext({ baseURL: 'http://localhost:3000' });
    try {
      const aliceSession = await register(aliceCtx, alice);
      const mallorySession = await register(malloryCtx, mallory);

      const createRes = await aliceCtx.post('/rooms', {
        headers: csrfHeaders(aliceSession),
        data: { name: `room-${suffix}`, visibility: 'public' },
      });
      expect(createRes.status()).toBe(200);
      const { data: { room } } = (await createRes.json()) as CreateRoomResponse;

      // Non-owner cannot delete the room.
      const forbidden = await malloryCtx.delete(`/rooms/${room.chatId}`, {
        headers: csrfHeaders(mallorySession),
      });
      expect(forbidden.status()).toBe(403);
      const forbiddenBody = (await forbidden.json()) as ErrorResponse;
      expect(forbiddenBody.error.code).toBe('FORBIDDEN');

      // Owner deletes the room.
      const ok = await aliceCtx.delete(`/rooms/${room.chatId}`, {
        headers: csrfHeaders(aliceSession),
      });
      expect(ok.status()).toBe(200);

      // Deleting again returns 404 — the soft-delete is visible to the
      // service layer as "not found" to avoid leaking tombstone state.
      const again = await aliceCtx.delete(`/rooms/${room.chatId}`, {
        headers: csrfHeaders(aliceSession),
      });
      expect(again.status()).toBe(404);
      const againBody = (await again.json()) as ErrorResponse;
      expect(againBody.error.code).toBe('NOT_FOUND');
    } finally {
      await aliceCtx.dispose();
      await malloryCtx.dispose();
    }
  });
});

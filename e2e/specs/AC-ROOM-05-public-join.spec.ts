import { test, expect, request as apiRequest } from '@playwright/test';
import { csrfHeaders, register } from '../utils/auth.js';

function uniqueSuffix(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

type CreateRoomResponse = { data: { room: { chatId: string } } };

type JoinResponse = { data: { membership: { role: 'owner' | 'admin' | 'member' } } };

type ErrorResponse = { error: { code: string; message: string } };

test.describe('AC-ROOM-05: public rooms can be joined', () => {
  test('non-member can join a public room and becomes a member', async () => {
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

      // Bob joins the public room.
      const joinRes = await bobCtx.post(`/rooms/${room.chatId}/join`, {
        headers: csrfHeaders(bobSession),
      });
      expect(joinRes.status()).toBe(200);
      const joinBody = (await joinRes.json()) as JoinResponse;
      expect(joinBody.data.membership.role).toBe('member');

      // Re-joining is idempotent — the role remains the same.
      const joinAgain = await bobCtx.post(`/rooms/${room.chatId}/join`, {
        headers: csrfHeaders(bobSession),
      });
      expect(joinAgain.status()).toBe(200);
      const againBody = (await joinAgain.json()) as JoinResponse;
      expect(againBody.data.membership.role).toBe('member');
    } finally {
      await aliceCtx.dispose();
      await bobCtx.dispose();
    }
  });

  test('private rooms cannot be joined via the public join endpoint', async () => {
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
        data: { name: `secret-${suffix}`, visibility: 'private' },
      });
      expect(created.status()).toBe(200);
      const { data: { room } } = (await created.json()) as CreateRoomResponse;

      const joinRes = await bobCtx.post(`/rooms/${room.chatId}/join`, {
        headers: csrfHeaders(bobSession),
      });
      expect(joinRes.status()).toBe(404);
      const joinBody = (await joinRes.json()) as ErrorResponse;
      expect(joinBody.error.code).toBe('NOT_FOUND');
    } finally {
      await aliceCtx.dispose();
      await bobCtx.dispose();
    }
  });
});

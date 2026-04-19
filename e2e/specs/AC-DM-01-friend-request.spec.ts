import { test, expect, request as apiRequest } from '@playwright/test';
import { csrfHeaders, register } from '../utils/auth.js';

function uniqueSuffix(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

type CreateFriendRequestResponse = {
  data: {
    request: {
      id: string;
      status: 'open';
      recipientUserId: string;
      recipientUsername: string;
      createdAt: string;
    };
  };
};

type ErrorResponse = {
  error: { code: string; message: string };
};

test.describe('AC-DM-01: sending a friend request', () => {
  test('open request is created; duplicate returns CONFLICT; unknown user returns NOT_FOUND', async () => {
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
      const res = await seed.post('/__test/seed', {
        data: { strategy: 'truncate' },
      });
      expect(res.status()).toBe(200);
    } finally {
      await seed.dispose();
    }

    const aliceCtx = await apiRequest.newContext({ baseURL: 'http://localhost:3000' });
    const bobCtx = await apiRequest.newContext({ baseURL: 'http://localhost:3000' });
    try {
      const aliceSession = await register(aliceCtx, alice);
      await register(bobCtx, bob);

      const created = await aliceCtx.post('/friends/requests', {
        headers: csrfHeaders(aliceSession),
        data: { recipientUsername: bob.username, message: 'hi bob' },
      });
      expect(created.status()).toBe(200);
      const body = (await created.json()) as CreateFriendRequestResponse;
      expect(body.data.request.status).toBe('open');
      expect(body.data.request.recipientUsername).toBe(bob.username);
      expect(body.data.request.id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
      );

      // Duplicate open request is rejected with CONFLICT.
      const dup = await aliceCtx.post('/friends/requests', {
        headers: csrfHeaders(aliceSession),
        data: { recipientUsername: bob.username },
      });
      expect(dup.status()).toBe(409);
      const dupBody = (await dup.json()) as ErrorResponse;
      expect(dupBody.error.code).toBe('CONFLICT');

      // Self-request rejected as VALIDATION_ERROR.
      const selfRes = await aliceCtx.post('/friends/requests', {
        headers: csrfHeaders(aliceSession),
        data: { recipientUsername: alice.username },
      });
      expect(selfRes.status()).toBe(400);
      const selfBody = (await selfRes.json()) as ErrorResponse;
      expect(selfBody.error.code).toBe('VALIDATION_ERROR');

      // Unknown target user → NOT_FOUND.
      const missing = await aliceCtx.post('/friends/requests', {
        headers: csrfHeaders(aliceSession),
        data: { recipientUsername: `ghost_${suffix}`.replace(/-/g, '_') },
      });
      expect(missing.status()).toBe(404);
      const missingBody = (await missing.json()) as ErrorResponse;
      expect(missingBody.error.code).toBe('NOT_FOUND');
    } finally {
      await aliceCtx.dispose();
      await bobCtx.dispose();
    }
  });
});

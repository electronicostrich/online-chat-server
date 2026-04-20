import { test, expect, request as apiRequest } from '@playwright/test';
import { csrfHeaders, register } from '../utils/auth.js';

function uniqueSuffix(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

type CreateFriendRequestResponse = {
  data: { request: { id: string; status: 'open' } };
};

type AcceptResponse = {
  data: {
    request: { id: string; status: string };
    friendship: { id: string; createdAt: string };
  };
};

type ErrorResponse = { error: { code: string; message: string } };

type SendDmResponse = {
  data: {
    chat: { id: string; created: boolean };
    message: { id: string };
  };
};

test.describe('AC-DM-02: friendship is created only on acceptance', () => {
  test('acceptance creates an active friendship and closes the request; DM becomes allowed', async () => {
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

      // Before acceptance the DM send path rejects.
      const dmBefore = await aliceCtx.post(
        `/dm/${bobSession.userId}/messages`,
        { headers: csrfHeaders(aliceSession), data: { bodyText: 'too early' } },
      );
      expect(dmBefore.status()).toBe(403);

      // Alice → Bob friend request.
      const createRes = await aliceCtx.post('/friends/requests', {
        headers: csrfHeaders(aliceSession),
        data: { recipientUsername: bob.username },
      });
      expect(createRes.status()).toBe(200);
      const { data: { request } } = (await createRes.json()) as CreateFriendRequestResponse;

      // Alice (requester) cannot accept her own request.
      const wrongActor = await aliceCtx.post(
        `/friends/requests/${request.id}/accept`,
        { headers: csrfHeaders(aliceSession) },
      );
      expect(wrongActor.status()).toBe(404);

      // Bob (recipient) accepts.
      const acceptRes = await bobCtx.post(
        `/friends/requests/${request.id}/accept`,
        { headers: csrfHeaders(bobSession) },
      );
      expect(acceptRes.status()).toBe(200);
      const acceptBody = (await acceptRes.json()) as AcceptResponse;
      expect(acceptBody.data.request.status).toBe('accepted');
      expect(acceptBody.data.friendship.id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
      );

      // Re-accept is rejected (the request is no longer open).
      const again = await bobCtx.post(
        `/friends/requests/${request.id}/accept`,
        { headers: csrfHeaders(bobSession) },
      );
      expect(again.status()).toBe(409);
      const againBody = (await again.json()) as ErrorResponse;
      expect(againBody.error.code).toBe('CONFLICT');

      // DM send now succeeds because friendship is active.
      const dmAfter = await aliceCtx.post(
        `/dm/${bobSession.userId}/messages`,
        { headers: csrfHeaders(aliceSession), data: { bodyText: 'hi bob' } },
      );
      expect(dmAfter.status()).toBe(200);
      const dmBody = (await dmAfter.json()) as SendDmResponse;
      expect(dmBody.data.chat.created).toBe(true);
    } finally {
      await aliceCtx.dispose();
      await bobCtx.dispose();
    }
  });
});

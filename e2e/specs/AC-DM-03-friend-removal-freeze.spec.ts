import { test, expect, request as apiRequest } from '@playwright/test';
import { csrfHeaders, register } from '../utils/auth.js';

function uniqueSuffix(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

type CreateFriendRequestResponse = {
  data: { request: { id: string } };
};

type SendDmResponse = {
  data: { chat: { id: string; created: boolean }; message: { id: string } };
};

type ErrorResponse = { error: { code: string; message: string } };

type MessagesResponse = {
  data: {
    chatId: string;
    headSequence: number;
    messages: Array<{ id: string; bodyText: string | null }>;
  };
};

test.describe('AC-DM-03: friend removal freezes existing DM', () => {
  test('either side removing ends friendship; send fails; history stays visible', async () => {
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

      // Build active friendship.
      const reqRes = await aliceCtx.post('/friends/requests', {
        headers: csrfHeaders(aliceSession),
        data: { recipientUsername: bob.username },
      });
      expect(reqRes.status()).toBe(200);
      const { data: { request } } = (await reqRes.json()) as CreateFriendRequestResponse;
      const acceptRes = await bobCtx.post(
        `/friends/requests/${request.id}/accept`,
        { headers: csrfHeaders(bobSession) },
      );
      expect(acceptRes.status()).toBe(200);

      // Send a first DM to create the chat.
      const dm = await aliceCtx.post(
        `/dm/${bobSession.userId}/messages`,
        { headers: csrfHeaders(aliceSession), data: { bodyText: 'hi bob' } },
      );
      expect(dm.status()).toBe(200);
      const dmBody = (await dm.json()) as SendDmResponse;
      const chatId = dmBody.data.chat.id;

      // Alice removes Bob.
      const remove = await aliceCtx.delete(`/friends/${bobSession.userId}`, {
        headers: csrfHeaders(aliceSession),
      });
      expect(remove.status()).toBe(200);

      // New DMs are rejected in both directions.
      const fromAlice = await aliceCtx.post(
        `/dm/${bobSession.userId}/messages`,
        { headers: csrfHeaders(aliceSession), data: { bodyText: 'still there?' } },
      );
      expect(fromAlice.status()).toBe(403);
      const fromAliceBody = (await fromAlice.json()) as ErrorResponse;
      expect(fromAliceBody.error.code).toBe('DM_NOT_ALLOWED');

      const fromBob = await bobCtx.post(
        `/dm/${aliceSession.userId}/messages`,
        { headers: csrfHeaders(bobSession), data: { bodyText: 'also blocked' } },
      );
      expect(fromBob.status()).toBe(403);

      // Existing history stays visible to both participants.
      const history = await bobCtx.get(`/chats/${chatId}/messages`, {
        headers: csrfHeaders(bobSession),
      });
      expect(history.status()).toBe(200);
      const historyBody = (await history.json()) as MessagesResponse;
      expect(historyBody.data.messages.length).toBeGreaterThanOrEqual(1);

      // Removing a non-friend returns NOT_FOUND.
      const orphan = await aliceCtx.delete(`/friends/${bobSession.userId}`, {
        headers: csrfHeaders(aliceSession),
      });
      expect(orphan.status()).toBe(404);
    } finally {
      await aliceCtx.dispose();
      await bobCtx.dispose();
    }
  });
});

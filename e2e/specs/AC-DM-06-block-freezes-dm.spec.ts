import { test, expect, request as apiRequest } from '@playwright/test';
import { csrfHeaders, register } from '../utils/auth.js';

function uniqueSuffix(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

type BlockResponse = {
  data: { ok: true; blockedUserId: string };
};

type FriendRequestErrorResponse = {
  error: { code: string; message: string };
};

// WS-04 owns direct-message send behaviour, so this spec covers the
// WS-03 slice of AC-DM-06: creating the block row and proving it
// propagates the "no DM / no friend requests" invariant to the surfaces
// WS-03 owns. The full message-send freeze test is deferred until WS-04
// lands the `/chats/{id}/messages` path.

test.describe('AC-DM-06: block user gates WS-03 relationship surfaces', () => {
  test('blocker → blocked: block is recorded; friend-request from either side is rejected', async () => {
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
      const bobSession = await register(bobCtx, bob);

      const block = await aliceCtx.post(`/blocks/${bobSession.userId}`, {
        headers: csrfHeaders(aliceSession),
      });
      expect(block.status()).toBe(200);
      const blockBody = (await block.json()) as BlockResponse;
      expect(blockBody.data.ok).toBe(true);
      expect(blockBody.data.blockedUserId).toBe(bobSession.userId);

      // Block is idempotent: the second call returns 200, not 409.
      const again = await aliceCtx.post(`/blocks/${bobSession.userId}`, {
        headers: csrfHeaders(aliceSession),
      });
      expect(again.status()).toBe(200);

      // Blocked user cannot send a friend request back to the blocker.
      const reverseFriendReq = await bobCtx.post('/friends/requests', {
        headers: csrfHeaders(bobSession),
        data: { recipientUsername: alice.username },
      });
      expect(reverseFriendReq.status()).toBe(403);
      const reverseBody =
        (await reverseFriendReq.json()) as FriendRequestErrorResponse;
      expect(reverseBody.error.code).toBe('DM_NOT_ALLOWED');

      // Blocker also cannot send a friend request forward — the block
      // applies in both directions.
      const forwardFriendReq = await aliceCtx.post('/friends/requests', {
        headers: csrfHeaders(aliceSession),
        data: { recipientUsername: bob.username },
      });
      expect(forwardFriendReq.status()).toBe(403);
      const forwardBody =
        (await forwardFriendReq.json()) as FriendRequestErrorResponse;
      expect(forwardBody.error.code).toBe('DM_NOT_ALLOWED');
    } finally {
      await aliceCtx.dispose();
      await bobCtx.dispose();
    }
  });

  test('self-block rejected as VALIDATION_ERROR', async () => {
    const suffix = uniqueSuffix();
    const alice = {
      email: `alice-${suffix}@example.com`,
      username: `alice_${suffix}`.replace(/-/g, '_'),
      password: 'StrongPassword123!',
    };

    const seed = await apiRequest.newContext({ baseURL: 'http://localhost:3000' });
    try {
      await seed.post('/__test/seed', { data: { strategy: 'truncate' } });
    } finally {
      await seed.dispose();
    }

    const ctx = await apiRequest.newContext({ baseURL: 'http://localhost:3000' });
    try {
      const session = await register(ctx, alice);
      const res = await ctx.post(`/blocks/${session.userId}`, {
        headers: csrfHeaders(session),
      });
      expect(res.status()).toBe(400);
      const body = (await res.json()) as FriendRequestErrorResponse;
      expect(body.error.code).toBe('VALIDATION_ERROR');
    } finally {
      await ctx.dispose();
    }
  });
});

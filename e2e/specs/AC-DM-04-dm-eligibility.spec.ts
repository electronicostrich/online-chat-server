import { test, expect, request as apiRequest } from '@playwright/test';
import { csrfHeaders } from '../utils/auth.js';

function uniqueSuffix(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

async function login(
  ctx: Awaited<ReturnType<typeof apiRequest.newContext>>,
  creds: { email: string; password: string },
): Promise<{ userId: string; csrfToken: string }> {
  const res = await ctx.post('/auth/login', {
    data: { email: creds.email, password: creds.password },
  });
  if (res.status() !== 200) {
    throw new Error(`login failed: ${res.status().toString()}`);
  }
  const setCookie = res.headers()['set-cookie'] ?? '';
  const match = /(?:^|[\n;,]\s*)csrf_token=([^;\n]+)/.exec(setCookie);
  const csrfToken = match?.[1] ?? '';
  const body = (await res.json()) as { data: { user: { id: string } } };
  return { userId: body.data.user.id, csrfToken };
}

// AC-DM-04: direct messaging requires friendship AND no block. The
// three failure modes are: not friends, friends-but-blocked-one-way,
// friends-but-blocked-other-way. Each returns `DM_NOT_ALLOWED` and
// must NOT create a direct chat row.
test.describe('AC-DM-04: DM requires friendship + no block', () => {
  test('rejects non-friends and blocked pairs; no direct chat is created', async () => {
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
    const carol = {
      email: `carol-${suffix}@example.com`,
      username: `carol_${suffix}`.replace(/-/g, '_'),
      password: 'StrongPassword123!',
    };

    // Alice ↔ Bob: not friends. Alice ↔ Carol: friends but Alice
    // blocked Carol. Both Carol → Alice and Alice → Carol should be
    // rejected because a block in either direction freezes DMs
    // (AC-DM-06 + AC-DM-04).
    const seed = await apiRequest.newContext({ baseURL: 'http://localhost:3000' });
    try {
      const res = await seed.post('/__test/seed', {
        data: {
          strategy: 'truncate',
          users: [alice, bob, carol],
          friendships: [{ userA: alice.username, userB: carol.username }],
          blocks: [{ blocker: alice.username, blocked: carol.username }],
        },
      });
      expect(res.status()).toBe(200);
    } finally {
      await seed.dispose();
    }

    const aliceCtx = await apiRequest.newContext({ baseURL: 'http://localhost:3000' });
    const bobCtx = await apiRequest.newContext({ baseURL: 'http://localhost:3000' });
    const carolCtx = await apiRequest.newContext({ baseURL: 'http://localhost:3000' });
    try {
      const aliceSession = await login(aliceCtx, alice);
      const bobSession = await login(bobCtx, bob);
      const carolSession = await login(carolCtx, carol);

      // Case 1: Alice → Bob, not friends → DM_NOT_ALLOWED.
      const notFriends = await aliceCtx.post(`/dm/${bobSession.userId}/messages`, {
        headers: csrfHeaders(aliceSession),
        data: { bodyText: 'hi' },
      });
      expect(notFriends.status()).toBe(403);
      const nfErr = (await notFriends.json()) as { error: { code: string } };
      expect(nfErr.error.code).toBe('DM_NOT_ALLOWED');

      // Case 2: Alice → Carol, friends but Alice blocked Carol →
      // DM_NOT_ALLOWED (block takes precedence over friendship).
      const blockedSend = await aliceCtx.post(`/dm/${carolSession.userId}/messages`, {
        headers: csrfHeaders(aliceSession),
        data: { bodyText: 'hi' },
      });
      expect(blockedSend.status()).toBe(403);
      const blockedErr = (await blockedSend.json()) as {
        error: { code: string };
      };
      expect(blockedErr.error.code).toBe('DM_NOT_ALLOWED');

      // Case 3: Carol → Alice, friends but Carol was blocked by Alice
      // → DM_NOT_ALLOWED (block is symmetric).
      const carolReplies = await carolCtx.post(`/dm/${aliceSession.userId}/messages`, {
        headers: csrfHeaders(carolSession),
        data: { bodyText: 'hi' },
      });
      expect(carolReplies.status()).toBe(403);
      const carolErr = (await carolReplies.json()) as {
        error: { code: string };
      };
      expect(carolErr.error.code).toBe('DM_NOT_ALLOWED');

      // The AC also requires that no writable direct chat is created
      // for any rejected send. Prove it via the test-only peek: both
      // Alice↔Bob and Alice↔Carol pairs must have zero direct chats
      // after all three rejections.
      const peek = await apiRequest.newContext({ baseURL: 'http://localhost:3000' });
      try {
        const aliceBob = await peek.get(
          `/__test/direct-chat-count?userA=${aliceSession.userId}&userB=${bobSession.userId}`,
        );
        expect(aliceBob.status()).toBe(200);
        expect(((await aliceBob.json()) as { data: { count: number } }).data.count).toBe(0);

        const aliceCarol = await peek.get(
          `/__test/direct-chat-count?userA=${aliceSession.userId}&userB=${carolSession.userId}`,
        );
        expect(aliceCarol.status()).toBe(200);
        expect(((await aliceCarol.json()) as { data: { count: number } }).data.count).toBe(0);
      } finally {
        await peek.dispose();
      }
    } finally {
      await aliceCtx.dispose();
      await bobCtx.dispose();
      await carolCtx.dispose();
    }
  });
});

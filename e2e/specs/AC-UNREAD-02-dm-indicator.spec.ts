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
  const body = (await res.json()) as { data: { user: { id: string } } };
  return { userId: body.data.user.id, csrfToken: match?.[1] ?? '' };
}

// AC-UNREAD-02: direct-chat unread indicator. A sends first DM, B's
// read-state reports hasUnread=true until B advances.
test.describe('AC-UNREAD-02: DM unread indicator', () => {
  test('recipient sees hasUnread=true until they advance read state', async () => {
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
        data: {
          strategy: 'truncate',
          users: [alice, bob],
          friendships: [{ userA: alice.username, userB: bob.username }],
        },
      });
      expect(res.status()).toBe(200);
    } finally {
      await seed.dispose();
    }

    const aliceCtx = await apiRequest.newContext({ baseURL: 'http://localhost:3000' });
    const bobCtx = await apiRequest.newContext({ baseURL: 'http://localhost:3000' });
    try {
      const aliceSession = await login(aliceCtx, alice);
      const bobSession = await login(bobCtx, bob);

      const sent = await aliceCtx.post(`/dm/${bobSession.userId}/messages`, {
        headers: csrfHeaders(aliceSession),
        data: { bodyText: 'hey bob' },
      });
      expect(sent.status()).toBe(200);
      const sentBody = (await sent.json()) as {
        data: { chat: { id: string }; message: { sequence: number } };
      };
      const chatId = sentBody.data.chat.id;

      const bobState = await bobCtx.get(`/chats/${chatId}/read-state`);
      expect(bobState.status()).toBe(200);
      const bs = (await bobState.json()) as {
        data: { hasUnread: boolean; lastReadSequence: number; headSequence: number };
      };
      expect(bs.data.lastReadSequence).toBe(0);
      expect(bs.data.headSequence).toBe(1);
      expect(bs.data.hasUnread).toBe(true);

      // Author's own side reports no unread for their own send (they
      // are synced to head implicitly? No — server is authoritative and
      // won't lie about this; the author can post and still show
      // hasUnread=true because they haven't explicitly advanced. The
      // AC clears unread only via POST /chats/{id}/read, so assert the
      // author is also hasUnread=true until they advance.)
      const aliceState = await aliceCtx.get(`/chats/${chatId}/read-state`);
      expect(aliceState.status()).toBe(200);
      const as = (await aliceState.json()) as {
        data: { hasUnread: boolean; lastReadSequence: number };
      };
      expect(as.data.lastReadSequence).toBe(0);
      expect(as.data.hasUnread).toBe(true);
    } finally {
      await aliceCtx.dispose();
      await bobCtx.dispose();
    }
  });
});

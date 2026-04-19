import { test, expect, request as apiRequest } from '@playwright/test';
import { csrfHeaders } from '../utils/auth.js';

function uniqueSuffix(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

type MessageShape = {
  id: string;
  chatId: string;
  bodyText: string | null;
  deletedAt: string | null;
};

// AC-MSG-06: direct-chat participants cannot delete each other's
// messages. Direct chats have no admin role, so the caller must be the
// author. A non-author participant gets FORBIDDEN.
test.describe('AC-MSG-06: DM delete is restricted to author', () => {
  test('non-author DM participant is FORBIDDEN; author may delete own', async () => {
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
      // Users exist in the DB already; login produces HTTP sessions.
      const aliceSession = await loginFromSeed(aliceCtx, alice);
      const bobSession = await loginFromSeed(bobCtx, bob);

      // Alice sends the first DM, which lazy-creates the direct chat.
      const sendFirst = await aliceCtx.post(`/dm/${bobSession.userId}/messages`, {
        headers: csrfHeaders(aliceSession),
        data: { bodyText: 'hello bob' },
      });
      expect(sendFirst.status()).toBe(200);
      const firstBody = (await sendFirst.json()) as {
        data: {
          chat: { id: string; created: boolean };
          message: MessageShape;
        };
      };
      const chatId = firstBody.data.chat.id;

      // Bob tries to delete Alice's message — rejected.
      const bobDelete = await bobCtx.delete(`/messages/${firstBody.data.message.id}`, {
        headers: csrfHeaders(bobSession),
      });
      expect(bobDelete.status()).toBe(403);
      const err = (await bobDelete.json()) as { error: { code: string } };
      expect(err.error.code).toBe('FORBIDDEN');

      // Alice deletes her own — allowed.
      const aliceDelete = await aliceCtx.delete(`/messages/${firstBody.data.message.id}`, {
        headers: csrfHeaders(aliceSession),
      });
      expect(aliceDelete.status()).toBe(200);

      // Deleted message still in history; content hidden.
      const history = await aliceCtx.get(`/chats/${chatId}/messages`);
      expect(history.status()).toBe(200);
      const historyBody = (await history.json()) as {
        data: { messages: MessageShape[] };
      };
      const row = historyBody.data.messages.find((m) => m.id === firstBody.data.message.id);
      expect(row).toBeDefined();
      expect(row?.deletedAt).not.toBeNull();
      expect(row?.bodyText).toBeNull();
    } finally {
      await aliceCtx.dispose();
      await bobCtx.dispose();
    }
  });
});

async function loginFromSeed(
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
  if (csrfToken.length === 0) {
    throw new Error('login did not set csrf_token');
  }
  const body = (await res.json()) as { data: { user: { id: string } } };
  return { userId: body.data.user.id, csrfToken };
}

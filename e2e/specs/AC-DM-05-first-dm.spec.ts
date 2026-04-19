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

// AC-DM-05: first successful DM creates the direct chat. The response
// must advertise `chat.created=true` on the first call for a given
// pair and `chat.created=false` on subsequent calls (same chat, same
// chatId). Per api-and-events §5.6.1 the second send prefers the
// chat-scoped endpoint — we assert the `chatId` matches across both
// endpoints.
test.describe('AC-DM-05: first DM creates the direct chat', () => {
  test('creates chat with two participants on first send; reuses chat on second send', async () => {
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

      const first = await aliceCtx.post(`/dm/${bobSession.userId}/messages`, {
        headers: csrfHeaders(aliceSession),
        data: { bodyText: 'hey bob' },
      });
      expect(first.status()).toBe(200);
      const firstBody = (await first.json()) as {
        data: {
          chat: { id: string; created: boolean };
          message: { sequence: number; authorUserId: string; chatId: string };
        };
      };
      expect(firstBody.data.chat.created).toBe(true);
      expect(firstBody.data.message.sequence).toBe(1);
      expect(firstBody.data.message.authorUserId).toBe(aliceSession.userId);
      expect(firstBody.data.message.chatId).toBe(firstBody.data.chat.id);

      // Second send via DM endpoint — chat already exists, so
      // `created=false`. Sequence advances to 2.
      const second = await aliceCtx.post(`/dm/${bobSession.userId}/messages`, {
        headers: csrfHeaders(aliceSession),
        data: { bodyText: 'one more' },
      });
      expect(second.status()).toBe(200);
      const secondBody = (await second.json()) as {
        data: {
          chat: { id: string; created: boolean };
          message: { sequence: number; chatId: string };
        };
      };
      expect(secondBody.data.chat.created).toBe(false);
      expect(secondBody.data.chat.id).toBe(firstBody.data.chat.id);
      expect(secondBody.data.message.sequence).toBe(2);

      // Bob can send to the same chat via the chat-scoped endpoint
      // because he's a participant.
      const bobReply = await bobCtx.post(`/chats/${firstBody.data.chat.id}/messages`, {
        headers: csrfHeaders(bobSession),
        data: { bodyText: 'hi alice' },
      });
      expect(bobReply.status()).toBe(200);
      const bobReplyBody = (await bobReply.json()) as {
        data: { message: { sequence: number; authorUserId: string } };
      };
      expect(bobReplyBody.data.message.sequence).toBe(3);
      expect(bobReplyBody.data.message.authorUserId).toBe(bobSession.userId);

      // History shows both participants and chronological ordering.
      const history = await aliceCtx.get(`/chats/${firstBody.data.chat.id}/messages`);
      expect(history.status()).toBe(200);
      const histBody = (await history.json()) as {
        data: {
          headSequence: number;
          messages: { sequence: number; authorUserId: string }[];
        };
      };
      expect(histBody.data.headSequence).toBe(3);
      const authors = new Set(histBody.data.messages.map((m) => m.authorUserId));
      expect(authors.has(aliceSession.userId)).toBe(true);
      expect(authors.has(bobSession.userId)).toBe(true);
    } finally {
      await aliceCtx.dispose();
      await bobCtx.dispose();
    }
  });
});

import { test, expect, request as apiRequest } from '@playwright/test';
import { csrfHeaders, register } from '../utils/auth.js';

function uniqueSuffix(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

type MessageShape = {
  id: string;
  chatId: string;
  sequence: number;
  authorUserId: string;
  kind: 'text' | 'system' | 'attachment';
  bodyText: string | null;
  replyToMessageId: string | null;
  createdAt: string;
  editedAt: string | null;
  deletedAt: string | null;
};

type SendMessageResponse = { data: { message: MessageShape } };

test.describe('AC-MSG-01: supported content forms', () => {
  test('room member sends plain text, multiline text, emoji, and a threaded reply', async () => {
    const suffix = uniqueSuffix();
    const alice = {
      email: `alice-${suffix}@example.com`,
      username: `alice_${suffix}`.replace(/-/g, '_'),
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

    const ctx = await apiRequest.newContext({ baseURL: 'http://localhost:3000' });
    try {
      const session = await register(ctx, alice);
      const roomName = `room-${suffix}`;
      const createRoom = await ctx.post('/rooms', {
        headers: csrfHeaders(session),
        data: { name: roomName, visibility: 'public' },
      });
      expect(createRoom.status()).toBe(200);
      const {
        data: { room },
      } = (await createRoom.json()) as {
        data: { room: { chatId: string } };
      };

      // Plain text
      const sendPlain = await ctx.post(`/chats/${room.chatId}/messages`, {
        headers: csrfHeaders(session),
        data: { bodyText: 'hello room' },
      });
      expect(sendPlain.status()).toBe(200);
      const plain = (await sendPlain.json()) as SendMessageResponse;
      expect(plain.data.message.bodyText).toBe('hello room');
      expect(plain.data.message.authorUserId).toBe(session.userId);
      expect(plain.data.message.chatId).toBe(room.chatId);
      expect(plain.data.message.kind).toBe('text');
      expect(plain.data.message.sequence).toBe(1);

      // Multiline + UTF-8 emoji
      const multi = await ctx.post(`/chats/${room.chatId}/messages`, {
        headers: csrfHeaders(session),
        data: { bodyText: 'line 1\nline 2 — 🎉\nline 3' },
      });
      expect(multi.status()).toBe(200);
      const multiBody = (await multi.json()) as SendMessageResponse;
      expect(multiBody.data.message.bodyText).toBe('line 1\nline 2 — 🎉\nline 3');
      expect(multiBody.data.message.sequence).toBe(2);

      // Threaded reply: replyToMessageId on the second message pointing at
      // the first.
      const reply = await ctx.post(`/chats/${room.chatId}/messages`, {
        headers: csrfHeaders(session),
        data: {
          bodyText: 'reply to first',
          replyToMessageId: plain.data.message.id,
        },
      });
      expect(reply.status()).toBe(200);
      const replyBody = (await reply.json()) as SendMessageResponse;
      expect(replyBody.data.message.replyToMessageId).toBe(plain.data.message.id);
      expect(replyBody.data.message.sequence).toBe(3);
    } finally {
      await ctx.dispose();
    }
  });

  test('rejects non-members with NOT_A_MEMBER and unauthenticated callers', async () => {
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
      const roomName = `private-${suffix}`;
      const createRoom = await aliceCtx.post('/rooms', {
        headers: csrfHeaders(aliceSession),
        data: { name: roomName, visibility: 'private' },
      });
      expect(createRoom.status()).toBe(200);
      const {
        data: { room },
      } = (await createRoom.json()) as {
        data: { room: { chatId: string } };
      };

      const notMember = await bobCtx.post(`/chats/${room.chatId}/messages`, {
        headers: csrfHeaders(bobSession),
        data: { bodyText: 'hi' },
      });
      expect(notMember.status()).toBe(403);
      const err = (await notMember.json()) as {
        error: { code: string };
      };
      expect(err.error.code).toBe('NOT_A_MEMBER');

      const anon = await apiRequest.newContext({ baseURL: 'http://localhost:3000' });
      try {
        const anonRes = await anon.post(`/chats/${room.chatId}/messages`, {
          data: { bodyText: 'hi' },
        });
        expect([401, 403]).toContain(anonRes.status());
      } finally {
        await anon.dispose();
      }
    } finally {
      await aliceCtx.dispose();
      await bobCtx.dispose();
    }
  });
});

import { test, expect, request as apiRequest } from '@playwright/test';
import { csrfHeaders, register } from '../utils/auth.js';

function uniqueSuffix(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

test.describe('AC-MSG-02: 3 KB message size limit', () => {
  test('rejects messages whose UTF-8 byte length exceeds 3 KB', async () => {
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
      const createRoom = await ctx.post('/rooms', {
        headers: csrfHeaders(session),
        data: { name: `room-${suffix}`, visibility: 'public' },
      });
      expect(createRoom.status()).toBe(200);
      const {
        data: { room },
      } = (await createRoom.json()) as {
        data: { room: { chatId: string } };
      };

      // Exactly 3 KB ASCII (within the limit).
      const exactly3k = 'a'.repeat(3 * 1024);
      const okRes = await ctx.post(`/chats/${room.chatId}/messages`, {
        headers: csrfHeaders(session),
        data: { bodyText: exactly3k },
      });
      expect(okRes.status()).toBe(200);

      // Just over 3 KB ASCII.
      const over = 'a'.repeat(3 * 1024 + 1);
      const overRes = await ctx.post(`/chats/${room.chatId}/messages`, {
        headers: csrfHeaders(session),
        data: { bodyText: over },
      });
      // The shared-schemas maxLength is a character count safety net that
      // trips at the same threshold as the byte check, so either
      // validation path is acceptable — both produce VALIDATION_ERROR.
      expect(overRes.status()).toBe(400);
      const overErr = (await overRes.json()) as { error: { code: string } };
      expect(overErr.error.code).toBe('VALIDATION_ERROR');

      // Multibyte case: 1024 × '😀' = 4096 bytes, well over 3 KB, but
      // only 2048 JS code units. The byte-length gate must still reject
      // it even though the JS string is under any naive character cap.
      const overEmoji = '😀'.repeat(1024);
      const emojiRes = await ctx.post(`/chats/${room.chatId}/messages`, {
        headers: csrfHeaders(session),
        data: { bodyText: overEmoji },
      });
      expect(emojiRes.status()).toBe(400);
      const emojiErr = (await emojiRes.json()) as { error: { code: string } };
      expect(emojiErr.error.code).toBe('VALIDATION_ERROR');

      // Empty body rejected.
      const emptyRes = await ctx.post(`/chats/${room.chatId}/messages`, {
        headers: csrfHeaders(session),
        data: { bodyText: '' },
      });
      expect(emptyRes.status()).toBe(400);
    } finally {
      await ctx.dispose();
    }
  });
});

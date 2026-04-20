import { test, expect, request as apiRequest } from '@playwright/test';
import { csrfHeaders, register } from '../utils/auth.js';

function uniqueSuffix(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

type CreateRoomResponse = { data: { room: { chatId: string } } };
type ErrorResponse = { error: { code: string; message: string } };

const IMAGE_LIMIT = 3 * 1024 * 1024;
const FILE_LIMIT = 20 * 1024 * 1024;

test.describe('AC-ATT-02: oversized uploads rejected', () => {
  test('oversize image (> 3 MiB) is rejected with PAYLOAD_TOO_LARGE', async () => {
    const suffix = uniqueSuffix();
    const alice = {
      email: `alice-${suffix}@example.com`,
      username: `alice_${suffix}`.replace(/-/g, '_'),
      password: 'StrongPassword123!',
    };

    const seed = await apiRequest.newContext({ baseURL: 'http://localhost:3000' });
    try {
      const res = await seed.post('/__test/seed', { data: { strategy: 'truncate' } });
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
      } = (await createRoom.json()) as CreateRoomResponse;

      // Claim `image/png` so the media-class branch picks the 3 MiB limit;
      // send 3 MiB + 1 byte so the post-parse check fires. Using a
      // modestly oversize payload keeps the test quick while still
      // exercising the correct error code.
      const payload = Buffer.alloc(IMAGE_LIMIT + 1, 1);
      const res = await ctx.post(`/chats/${room.chatId}/attachments`, {
        headers: csrfHeaders(session),
        multipart: {
          file: { name: 'big.png', mimeType: 'image/png', buffer: payload },
        },
      });
      expect(res.status()).toBe(413);
      const err = (await res.json()) as ErrorResponse;
      expect(err.error.code).toBe('PAYLOAD_TOO_LARGE');
    } finally {
      await ctx.dispose();
    }
  });

  test('oversize non-image (> 20 MiB) is rejected at the transport layer', async () => {
    const suffix = uniqueSuffix();
    const alice = {
      email: `alice-${suffix}@example.com`,
      username: `alice_${suffix}`.replace(/-/g, '_'),
      password: 'StrongPassword123!',
    };

    const seed = await apiRequest.newContext({ baseURL: 'http://localhost:3000' });
    try {
      const res = await seed.post('/__test/seed', { data: { strategy: 'truncate' } });
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
      } = (await createRoom.json()) as CreateRoomResponse;

      // 20 MiB + 1 byte with a non-image MIME type hits the 20 MiB cap.
      // The upload trips @fastify/multipart's `truncated` flag, which
      // the service maps to PAYLOAD_TOO_LARGE instead of silently
      // succeeding with a partial file.
      const payload = Buffer.alloc(FILE_LIMIT + 1, 2);
      const res = await ctx.post(`/chats/${room.chatId}/attachments`, {
        headers: csrfHeaders(session),
        multipart: {
          file: { name: 'big.bin', mimeType: 'application/octet-stream', buffer: payload },
        },
        timeout: 60_000,
      });
      expect(res.status()).toBe(413);
      const err = (await res.json()) as ErrorResponse;
      expect(err.error.code).toBe('PAYLOAD_TOO_LARGE');
    } finally {
      await ctx.dispose();
    }
  });
});

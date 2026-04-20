import { test, expect, request as apiRequest } from '@playwright/test';
import { csrfHeaders, register } from '../utils/auth.js';

function uniqueSuffix(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

type CreateRoomResponse = { data: { room: { chatId: string } } };
type UploadResponse = { data: { attachment: { id: string } } };
type ErrorResponse = { error: { code: string } };

test.describe('AC-ATT-04: room deletion removes attachments', () => {
  test('attachments become unreachable after the owner deletes the room', async () => {
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

      const upload = await ctx.post(`/chats/${room.chatId}/attachments`, {
        headers: csrfHeaders(session),
        multipart: {
          file: { name: 'note.txt', mimeType: 'text/plain', buffer: Buffer.from('to be deleted') },
        },
      });
      expect(upload.status()).toBe(200);
      const { data: { attachment } } = (await upload.json()) as UploadResponse;

      // Sanity-check: the owner can download while the room exists.
      const ok = await ctx.get(`/attachments/${attachment.id}/download`);
      expect(ok.status()).toBe(200);

      // Owner deletes the room — WS-03's deleteRoom soft-deletes the
      // underlying chat via `chats.deleted_at`.
      const del = await ctx.delete(`/rooms/${room.chatId}`, {
        headers: csrfHeaders(session),
      });
      expect(del.status()).toBe(200);

      // The attachment is now unreachable via the download endpoint
      // because `loadChatForDownload` requires `chats.deleted_at IS
      // NULL`. Even the original uploader (and owner!) sees a 404.
      const gone = await ctx.get(`/attachments/${attachment.id}/download`);
      expect(gone.status()).toBe(404);
      const err = (await gone.json()) as ErrorResponse;
      expect(err.error.code).toBe('NOT_FOUND');
    } finally {
      await ctx.dispose();
    }
  });
});

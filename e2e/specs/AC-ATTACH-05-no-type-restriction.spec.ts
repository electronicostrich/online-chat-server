import { test, expect, request as apiRequest } from '@playwright/test';
import { csrfHeaders, register } from '../utils/auth.js';

function uniqueSuffix(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

type CreateRoomResponse = { data: { room: { chatId: string } } };
type UploadResponse = {
  data: { attachment: { id: string; mimeType: string | null } };
};

test.describe('AC-ATTACH-05: no file-type restriction within limits', () => {
  test('uploads succeed for diverse MIME types and extensions', async () => {
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

      // Exhaust the "file type blacklist" failure modes: an executable
      // extension, an unknown MIME, and an image MIME. All three
      // should succeed because the service never inspects the MIME
      // type beyond the image-size branch.
      const samples = [
        {
          name: 'malware.exe',
          mimeType: 'application/vnd.microsoft.portable-executable',
          buffer: Buffer.from('MZ fake exe'),
        },
        {
          name: 'data.xyz',
          mimeType: 'application/octet-stream',
          buffer: Buffer.from('who knows what'),
        },
        {
          name: 'fake.iso',
          mimeType: 'application/x-iso9660-image',
          buffer: Buffer.from('ISO contents'),
        },
        {
          name: 'script.sh',
          mimeType: 'text/x-shellscript',
          buffer: Buffer.from('#!/bin/sh\necho hi'),
        },
        {
          // Image branch: proves the 3 MiB image cap doesn't reject a
          // small image, and that the type-branch logic doesn't
          // otherwise rewrite bytes.
          name: 'pixel.png',
          mimeType: 'image/png',
          buffer: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        },
      ];

      for (const sample of samples) {
        const res = await ctx.post(`/chats/${room.chatId}/attachments`, {
          headers: csrfHeaders(session),
          multipart: {
            file: { name: sample.name, mimeType: sample.mimeType, buffer: sample.buffer },
          },
        });
        expect(res.status(), `expected ${sample.name} upload to succeed`).toBe(200);
        const body = (await res.json()) as UploadResponse;
        expect(body.data.attachment.mimeType).toBe(sample.mimeType);

        // Fetch each back to prove bytes round-trip without any
        // type-specific rewrite.
        const dl = await ctx.get(`/attachments/${body.data.attachment.id}/download`);
        expect(dl.status()).toBe(200);
        const bytes = await dl.body();
        expect(bytes.equals(sample.buffer)).toBe(true);
      }
    } finally {
      await ctx.dispose();
    }
  });
});

import { test, expect, request as apiRequest } from '@playwright/test';
import { csrfHeaders, register } from '../utils/auth.js';

function uniqueSuffix(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

type CreateRoomResponse = { data: { room: { chatId: string } } };
type UploadResponse = {
  data: {
    attachment: {
      id: string;
      originalFilename: string;
    };
  };
};

test.describe('AC-ATTACH-06: filename preserved, sanitized on download', () => {
  test('preserves original filename in metadata and exposes both ASCII and UTF-8 Content-Disposition', async () => {
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

      // The multipart parser strips path components from the filename
      // for security (busboy behavior), so the transport layer already
      // removes `..` segments before the filename ever reaches us.
      // That leaves the sanitizer covering:
      // - UTF-8 preservation (é, em-dash)
      // - control-byte stripping (\t must not end up in metadata)
      // - ASCII-fallback collapsing of non-ASCII bytes
      const originalFilename = 'résumé — café\treport.pdf';
      const upload = await ctx.post(`/chats/${room.chatId}/attachments`, {
        headers: csrfHeaders(session),
        multipart: {
          file: {
            name: originalFilename,
            mimeType: 'application/pdf',
            buffer: Buffer.from('pdf bytes'),
          },
        },
      });
      expect(upload.status()).toBe(200);
      const body = (await upload.json()) as UploadResponse;
      // The stored original filename keeps the printable UTF-8 but
      // drops the control character.
      expect(body.data.attachment.originalFilename).toBe('résumé — caféreport.pdf');

      const dl = await ctx.get(`/attachments/${body.data.attachment.id}/download`);
      expect(dl.status()).toBe(200);
      const headers = dl.headers();
      const disposition = headers['content-disposition'];
      expect(disposition).toBeDefined();
      // ASCII fallback: non-ASCII bytes (accented letters, em-dash,
      // spaces) all collapse to `_` so the quoted filename parameter
      // can never be broken by a rogue byte.
      expect(disposition).toMatch(/filename="r_sum____caf_report\.pdf"/u);
      // RFC 5987 form: percent-encoded UTF-8 bytes survive the
      // round-trip. %C3%A9 is é; %E2%80%94 is em-dash; %20 is space.
      expect(disposition).toContain("filename*=UTF-8''");
      expect(disposition).toMatch(/r%C3%A9sum%C3%A9%20%E2%80%94%20caf%C3%A9report\.pdf/u);
      // Safety headers that protect the download path.
      expect(headers['x-content-type-options']).toBe('nosniff');
      expect(headers['cache-control']).toBe('private, no-store');
    } finally {
      await ctx.dispose();
    }
  });
});

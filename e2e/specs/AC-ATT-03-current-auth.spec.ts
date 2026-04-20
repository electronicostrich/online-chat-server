import { test, expect, request as apiRequest } from '@playwright/test';
import { csrfHeaders, register } from '../utils/auth.js';

function uniqueSuffix(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

type CreateRoomResponse = { data: { room: { chatId: string } } };
type UploadResponse = { data: { attachment: { id: string } } };
type ErrorResponse = { error: { code: string } };

test.describe('AC-ATT-03: attachment access follows current room membership', () => {
  test('uploader loses download access after losing room membership', async () => {
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
      const res = await seed.post('/__test/seed', { data: { strategy: 'truncate' } });
      expect(res.status()).toBe(200);
    } finally {
      await seed.dispose();
    }

    const aliceCtx = await apiRequest.newContext({ baseURL: 'http://localhost:3000' });
    const bobCtx = await apiRequest.newContext({ baseURL: 'http://localhost:3000' });
    try {
      const aliceSession = await register(aliceCtx, alice);
      const bobSession = await register(bobCtx, bob);

      // Alice creates the room; Bob is added as a member via the test
      // seed (WS-03 doesn't yet expose a join endpoint for private
      // rooms so the spec uses the append-mode seed path that WS-04
      // already validated).
      const createRoom = await aliceCtx.post('/rooms', {
        headers: csrfHeaders(aliceSession),
        data: { name: `room-${suffix}`, visibility: 'private' },
      });
      expect(createRoom.status()).toBe(200);
      const {
        data: { room },
      } = (await createRoom.json()) as CreateRoomResponse;

      const appendSeed = await apiRequest.newContext({ baseURL: 'http://localhost:3000' });
      try {
        const res = await appendSeed.post('/__test/seed', {
          data: {
            strategy: 'append',
            roomMembershipsByChatId: [
              { chatId: room.chatId, username: bob.username, role: 'member' },
            ],
          },
        });
        expect(res.status()).toBe(200);
      } finally {
        await appendSeed.dispose();
      }

      // Bob uploads a file while he's a member.
      const upload = await bobCtx.post(`/chats/${room.chatId}/attachments`, {
        headers: csrfHeaders(bobSession),
        multipart: {
          file: { name: 'bob.txt', mimeType: 'text/plain', buffer: Buffer.from('bob was here') },
        },
      });
      expect(upload.status()).toBe(200);
      const { data: { attachment } } = (await upload.json()) as UploadResponse;

      // Sanity-check: while he's still a member, the download works.
      const ok = await bobCtx.get(`/attachments/${attachment.id}/download`);
      expect(ok.status()).toBe(200);
      const okBody = await ok.body();
      expect(okBody.toString('utf-8')).toBe('bob was here');

      // Now expire Bob's membership — simulates a room admin removing
      // him (AC-MOD-02 style, still deferred in WS-03). The WS-06
      // test-only helper flips `left_at` so Bob loses current access
      // without touching WS-03's moderation surface.
      const expire = await apiRequest.newContext({ baseURL: 'http://localhost:3000' });
      try {
        const res = await expire.post('/__test/ws06/expire-membership', {
          data: { chatId: room.chatId, userId: bobSession.userId },
        });
        expect(res.status()).toBe(200);
      } finally {
        await expire.dispose();
      }

      // Post-eviction: Bob can no longer download his own upload.
      const rejected = await bobCtx.get(`/attachments/${attachment.id}/download`);
      expect(rejected.status()).toBe(404);
      const err = (await rejected.json()) as ErrorResponse;
      expect(err.error.code).toBe('NOT_FOUND');

      // Alice (still a member) can still download it — proves the
      // check is per-caller, not attachment-wide.
      const aliceDownload = await aliceCtx.get(`/attachments/${attachment.id}/download`);
      expect(aliceDownload.status()).toBe(200);
    } finally {
      await aliceCtx.dispose();
      await bobCtx.dispose();
    }
  });

  test('unauthenticated caller cannot download', async () => {
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

    const aliceCtx = await apiRequest.newContext({ baseURL: 'http://localhost:3000' });
    try {
      const aliceSession = await register(aliceCtx, alice);
      const createRoom = await aliceCtx.post('/rooms', {
        headers: csrfHeaders(aliceSession),
        data: { name: `room-${suffix}`, visibility: 'private' },
      });
      expect(createRoom.status()).toBe(200);
      const {
        data: { room },
      } = (await createRoom.json()) as CreateRoomResponse;

      const upload = await aliceCtx.post(`/chats/${room.chatId}/attachments`, {
        headers: csrfHeaders(aliceSession),
        multipart: {
          file: { name: 'secret.txt', mimeType: 'text/plain', buffer: Buffer.from('s3cret') },
        },
      });
      expect(upload.status()).toBe(200);
      const { data: { attachment } } = (await upload.json()) as UploadResponse;

      const anon = await apiRequest.newContext({ baseURL: 'http://localhost:3000' });
      try {
        // Anon callers stop at the shared `requireSession` guard
        // before any attachment-specific logic runs, so the response
        // is UNAUTHENTICATED/401 — not the 404 that ex-members get.
        // The guard never touches the attachment row, so it doesn't
        // leak whether the id exists either.
        const res = await anon.get(`/attachments/${attachment.id}/download`);
        expect(res.status()).toBe(401);
        const err = (await res.json()) as ErrorResponse;
        expect(err.error.code).toBe('UNAUTHENTICATED');
      } finally {
        await anon.dispose();
      }
    } finally {
      await aliceCtx.dispose();
    }
  });
});

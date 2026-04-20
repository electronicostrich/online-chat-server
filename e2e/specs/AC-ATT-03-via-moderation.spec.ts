import { test, expect, request as apiRequest } from '@playwright/test';
import { csrfHeaders, register } from '../utils/auth.js';

// Cross-workstream composite spec owned by WS-08 per the test-ownership
// table in docs/workstreams/workstream-dependency-and-interface-map.md
// ("upload file -> remove from room -> lose download access"). The
// AC-ATT-03 row is the user-visible contract it strengthens; this spec
// proves the seam end-to-end via the real AC-MOD-02 moderation endpoint
// (`POST /rooms/{id}/members/{uid}/remove`) instead of the WS-06
// test-only `__test/ws06/expire-membership` helper that the original
// AC-ATT-03 spec still uses. If this spec passes, the attachment
// authorization rule ("access follows current membership") composes
// correctly with the moderation state the room admin actually mutates
// in production — not with a membership flip the test helper stages on
// its behalf.

function uniqueSuffix(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

type CreateRoomResponse = { data: { room: { chatId: string } } };
type UploadResponse = { data: { attachment: { id: string } } };
type ErrorResponse = { error: { code: string } };
type BansResponse = {
  data: {
    bans: Array<{
      userId: string;
      username: string;
      bannedByUserId: string | null;
    }>;
  };
};

test.describe('AC-ATT-03 via real AC-MOD-02: upload → remove → lose-download-access', () => {
  test('admin-triggered removal revokes the removed user\'s own download', async () => {
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

      // Alice creates a public room. Using public + real join avoids
      // the append-seed path the original AC-ATT-03 spec relied on.
      const createRoom = await aliceCtx.post('/rooms', {
        headers: csrfHeaders(aliceSession),
        data: { name: `open-${suffix}`, visibility: 'public' },
      });
      expect(createRoom.status()).toBe(200);
      const {
        data: { room },
      } = (await createRoom.json()) as CreateRoomResponse;

      // Bob joins via the real join endpoint — proves he's a current
      // member through WS-03's membership writer, not a seed insert.
      const join = await bobCtx.post(`/rooms/${room.chatId}/join`, {
        headers: csrfHeaders(bobSession),
      });
      expect(join.status()).toBe(200);

      // Bob uploads while he's a member.
      const payload = 'bob was here — composite integration spec';
      const upload = await bobCtx.post(`/chats/${room.chatId}/attachments`, {
        headers: csrfHeaders(bobSession),
        multipart: {
          file: {
            name: 'bob.txt',
            mimeType: 'text/plain',
            buffer: Buffer.from(payload),
          },
        },
      });
      expect(upload.status()).toBe(200);
      const {
        data: { attachment },
      } = (await upload.json()) as UploadResponse;

      // Sanity: as a current member, Bob can download.
      const memberDownload = await bobCtx.get(
        `/attachments/${attachment.id}/download`,
      );
      expect(memberDownload.status()).toBe(200);
      const memberBody = await memberDownload.body();
      expect(memberBody.toString('utf-8')).toBe(payload);

      // AC-MOD-02: Alice (owner/admin) removes Bob. This is the real
      // moderation path — no test helper involved.
      const remove = await aliceCtx.post(
        `/rooms/${room.chatId}/members/${bobSession.userId}/remove`,
        { headers: csrfHeaders(aliceSession) },
      );
      expect(remove.status()).toBe(200);

      // AC-MOD-02 side effect: Bob now appears on the ban list, with
      // Alice recorded as the actor. Proves the moderation state was
      // actually mutated (not just a no-op 200).
      const banList = await aliceCtx.get(`/rooms/${room.chatId}/bans`, {
        headers: csrfHeaders(aliceSession),
      });
      expect(banList.status()).toBe(200);
      const bans = (await banList.json()) as BansResponse;
      const banRow = bans.data.bans.find((b) => b.userId === bobSession.userId);
      expect(banRow).toBeDefined();
      expect(banRow?.bannedByUserId).toBe(aliceSession.userId);

      // AC-ATT-03 core assertion: the very same attachment Bob could
      // download a moment ago is now 404 to him. The authorization
      // check re-reads current membership — which the moderation call
      // flipped — so the download is rejected without any additional
      // attachment-layer mutation.
      const afterRemoval = await bobCtx.get(
        `/attachments/${attachment.id}/download`,
      );
      expect(afterRemoval.status()).toBe(404);
      const afterErr = (await afterRemoval.json()) as ErrorResponse;
      expect(afterErr.error.code).toBe('NOT_FOUND');

      // Alice (still a current member — owner) can still download the
      // file. Proves the revoke is per-caller, not an attachment-wide
      // soft-delete.
      const aliceDownload = await aliceCtx.get(
        `/attachments/${attachment.id}/download`,
      );
      expect(aliceDownload.status()).toBe(200);
      const aliceBody = await aliceDownload.body();
      expect(aliceBody.toString('utf-8')).toBe(payload);

      // Cross-check against AC-ROOM-06: the ban the removal recorded
      // also blocks re-join, so Bob can't regain access by re-entering
      // the room. This makes the "former member" status durable
      // end-to-end.
      const rejoin = await bobCtx.post(`/rooms/${room.chatId}/join`, {
        headers: csrfHeaders(bobSession),
      });
      expect(rejoin.status()).toBe(403);
      const rejoinErr = (await rejoin.json()) as ErrorResponse;
      expect(rejoinErr.error.code).toBe('ROOM_BANNED');

      // And after the failed rejoin, the download is still 404 — i.e.
      // an unsuccessful re-join attempt did not accidentally promote
      // Bob back to current-member state.
      const finalDownload = await bobCtx.get(
        `/attachments/${attachment.id}/download`,
      );
      expect(finalDownload.status()).toBe(404);
    } finally {
      await aliceCtx.dispose();
      await bobCtx.dispose();
    }
  });
});

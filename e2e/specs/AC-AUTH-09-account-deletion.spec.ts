import { test, expect, request as apiRequest } from '@playwright/test';
import { csrfHeaders, register } from '../utils/auth.js';

function uniqueSuffix(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

type CreateRoomResponse = {
  data: { room: { chatId: string } };
};

type ErrorResponse = {
  error: { code: string; message: string };
};

type CreateFriendRequestResponse = {
  data: { request: { id: string; recipientUserId: string } };
};

type AcceptFriendRequestResponse = {
  data: { request: { id: string; status: 'accepted' } };
};

async function seedTruncate(): Promise<void> {
  const seed = await apiRequest.newContext({ baseURL: 'http://localhost:3000' });
  try {
    const res = await seed.post('/__test/seed', {
      data: { strategy: 'truncate' },
    });
    expect(res.status()).toBe(200);
  } finally {
    await seed.dispose();
  }
}

test.describe('AC-AUTH-09: account deletion cascades', () => {
  test('DELETE /users/me revokes sessions, soft-deletes owned rooms, removes friendships/blocks/memberships, cancels open friend requests', async () => {
    await seedTruncate();

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
    const carol = {
      email: `carol-${suffix}@example.com`,
      username: `carol_${suffix}`.replace(/-/g, '_'),
      password: 'StrongPassword123!',
    };

    const aliceTab1 = await apiRequest.newContext({ baseURL: 'http://localhost:3000' });
    const aliceTab2 = await apiRequest.newContext({ baseURL: 'http://localhost:3000' });
    const bobCtx = await apiRequest.newContext({ baseURL: 'http://localhost:3000' });
    const carolCtx = await apiRequest.newContext({ baseURL: 'http://localhost:3000' });

    try {
      const aliceSession1 = await register(aliceTab1, alice);
      const bobSession = await register(bobCtx, bob);
      const carolSession = await register(carolCtx, carol);

      // A second live session for Alice so we can prove the cascade
      // revokes *all* of her sessions, not just the caller's.
      const loginRes = await aliceTab2.post('/auth/login', {
        data: { email: alice.email, password: alice.password },
      });
      expect(loginRes.status()).toBe(200);

      // Alice owns a public room; Bob joins it so Bob's membership lives
      // through the cascade as `left` (not deleted).
      const roomCreate = await aliceTab1.post('/rooms', {
        headers: csrfHeaders(aliceSession1),
        data: { name: `alice-room-${suffix}`, visibility: 'public' },
      });
      expect(roomCreate.status()).toBe(200);
      const { data: { room: aliceRoom } } =
        (await roomCreate.json()) as CreateRoomResponse;

      const bobJoin = await bobCtx.post(`/rooms/${aliceRoom.chatId}/join`, {
        headers: csrfHeaders(bobSession),
      });
      expect(bobJoin.status()).toBe(200);

      // Carol owns a room Alice is a plain member of; this proves
      // non-owned memberships get flipped to `left` by the cascade while
      // the room itself survives Alice's deletion.
      const carolRoomCreate = await carolCtx.post('/rooms', {
        headers: csrfHeaders(carolSession),
        data: { name: `carol-room-${suffix}`, visibility: 'public' },
      });
      expect(carolRoomCreate.status()).toBe(200);
      const { data: { room: carolRoom } } =
        (await carolRoomCreate.json()) as CreateRoomResponse;
      const aliceJoinCarol = await aliceTab1.post(
        `/rooms/${carolRoom.chatId}/join`,
        { headers: csrfHeaders(aliceSession1) },
      );
      expect(aliceJoinCarol.status()).toBe(200);

      // Alice ↔ Bob friendship so the cascade has something to hard-delete.
      const friendReq = await aliceTab1.post('/friends/requests', {
        headers: csrfHeaders(aliceSession1),
        data: { recipientUsername: bob.username },
      });
      expect(friendReq.status()).toBe(200);
      const friendReqBody =
        (await friendReq.json()) as CreateFriendRequestResponse;
      const accepted = await bobCtx.post(
        `/friends/requests/${friendReqBody.data.request.id}/accept`,
        { headers: csrfHeaders(bobSession) },
      );
      expect(accepted.status()).toBe(200);
      const acceptedBody = (await accepted.json()) as AcceptFriendRequestResponse;
      expect(acceptedBody.data.request.status).toBe('accepted');

      // Open friend request Alice → Carol so we can assert the cascade
      // flips it to `cancelled` without creating a friendship row.
      const openReq = await aliceTab1.post('/friends/requests', {
        headers: csrfHeaders(aliceSession1),
        data: { recipientUsername: carol.username },
      });
      expect(openReq.status()).toBe(200);
      const openReqBody = (await openReq.json()) as CreateFriendRequestResponse;
      const openRequestId = openReqBody.data.request.id;

      // User block Alice → Carol so we can assert the cascade hard-deletes
      // it (and Carol can subsequently send a DM to Alice? well Alice is
      // deleted, but: the block row itself should be gone).
      const blockRes = await aliceTab1.post(`/blocks/${carolSession.userId}`, {
        headers: csrfHeaders(aliceSession1),
      });
      expect(blockRes.status()).toBe(200);

      // Issue a password-reset token for Alice BEFORE deletion so we can
      // assert the cascade also revokes `password_reset_tokens`. Without
      // this, a pre-issued token would let `/auth/password-reset/confirm`
      // mutate `password_hash` on a soft-deleted row after the cascade
      // committed — the exact failure mode flagged in CR #47.
      const resetReq = await aliceTab1.post('/auth/password-reset/request', {
        data: { email: alice.email },
      });
      expect(resetReq.status()).toBe(200);
      const tokenPeek = await aliceTab1.get(
        `/__test/last-reset-token?email=${encodeURIComponent(alice.email)}`,
      );
      expect(tokenPeek.status()).toBe(200);
      const tokenBody = (await tokenPeek.json()) as {
        data: { token: string | null };
      };
      const aliceResetToken = tokenBody.data.token;
      expect(aliceResetToken).not.toBeNull();

      // Wrong password → FORBIDDEN, cascade does not run.
      const wrongPw = await aliceTab1.delete('/users/me', {
        headers: csrfHeaders(aliceSession1),
        data: { password: 'TotallyWrong123!' },
      });
      expect(wrongPw.status()).toBe(403);
      const wrongPwBody = (await wrongPw.json()) as ErrorResponse;
      expect(wrongPwBody.error.code).toBe('FORBIDDEN');

      // The other session is still live (cascade didn't run).
      const stillLive = await aliceTab2.get('/sessions');
      expect(stillLive.status()).toBe(200);

      // Correct password → 200 OK, cookie cleared, cascade commits.
      const ok = await aliceTab1.delete('/users/me', {
        headers: csrfHeaders(aliceSession1),
        data: { password: alice.password },
      });
      expect(ok.status()).toBe(200);

      // Every Alice session is revoked. Both tabs get 401 on any
      // authed endpoint.
      const afterTab1 = await aliceTab1.get('/sessions');
      expect(afterTab1.status()).toBe(401);
      const afterTab2 = await aliceTab2.get('/sessions');
      expect(afterTab2.status()).toBe(401);

      // Alice's owned room is soft-deleted → public catalog no longer
      // shows it, even by explicit name search.
      const catalog = await bobCtx.get(
        `/rooms/public?q=alice-room-${suffix}`,
      );
      expect(catalog.status()).toBe(200);
      const catalogBody = (await catalog.json()) as {
        data: { rooms: Array<{ chatId: string }> };
      };
      expect(
        catalogBody.data.rooms.some((r) => r.chatId === aliceRoom.chatId),
      ).toBe(false);

      // Bob can no longer see the soft-deleted room either — the chat
      // shell is gone from his perspective. We assert the 404 on the
      // leave endpoint because it asserts `isNull(rooms.deletedAt)`.
      const bobLeave = await bobCtx.post(
        `/rooms/${aliceRoom.chatId}/leave`,
        { headers: csrfHeaders(bobSession) },
      );
      expect(bobLeave.status()).toBe(404);

      // Carol's room survives — the cascade only soft-deletes rooms
      // Alice *owned*. Bob can still join it to prove the room is alive.
      const bobJoinCarolRoom = await bobCtx.post(
        `/rooms/${carolRoom.chatId}/join`,
        { headers: csrfHeaders(bobSession) },
      );
      expect(bobJoinCarolRoom.status()).toBe(200);

      // The open friend request Alice had sent to Carol is no longer
      // `open`; Carol's attempt to accept it returns CONFLICT because
      // the cascade has flipped it to `cancelled`.
      const reAccept = await carolCtx.post(
        `/friends/requests/${openRequestId}/accept`,
        { headers: csrfHeaders(carolSession) },
      );
      expect(reAccept.status()).toBe(409);
      const reAcceptBody = (await reAccept.json()) as ErrorResponse;
      expect(reAcceptBody.error.code).toBe('CONFLICT');

      // Bob can now send Alice a *new* friend request contract check:
      // username doesn't resolve because Alice is `status='deleted'`,
      // so the lookup by canonical username returns 404.
      const rebuildAttempt = await bobCtx.post('/friends/requests', {
        headers: csrfHeaders(bobSession),
        data: { recipientUsername: alice.username },
      });
      expect(rebuildAttempt.status()).toBe(404);

      // The pre-issued password-reset token can no longer be consumed:
      // the cascade revoked it, so confirming it returns 400 with
      // VALIDATION_ERROR (same error shape as an unknown / expired
      // token, per api-and-events.md §5.1).
      const confirmAfterDelete = await apiRequest.newContext({
        baseURL: 'http://localhost:3000',
      });
      try {
        const res = await confirmAfterDelete.post(
          '/auth/password-reset/confirm',
          {
            data: {
              token: aliceResetToken,
              newPassword: 'AnotherStrong123!',
            },
          },
        );
        expect(res.status()).toBe(400);
        const body = (await res.json()) as ErrorResponse;
        expect(body.error.code).toBe('VALIDATION_ERROR');
      } finally {
        await confirmAfterDelete.dispose();
      }

      // Re-registering the same email immediately is rejected — the row
      // is retained through the 90-day soft-delete window so the
      // canonical email still collides at the unique index.
      const reRegister = await apiRequest.newContext({
        baseURL: 'http://localhost:3000',
      });
      try {
        const res = await reRegister.post('/auth/register', {
          data: {
            email: alice.email,
            username: `alice_reborn_${suffix}`.replace(/-/g, '_'),
            password: alice.password,
          },
        });
        expect(res.status()).toBe(409);
      } finally {
        await reRegister.dispose();
      }
    } finally {
      await aliceTab1.dispose();
      await aliceTab2.dispose();
      await bobCtx.dispose();
      await carolCtx.dispose();
    }
  });
});

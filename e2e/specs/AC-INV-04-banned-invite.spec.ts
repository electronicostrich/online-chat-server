import { test, expect, request as apiRequest } from '@playwright/test';
import { csrfHeaders, register } from '../utils/auth.js';

function uniqueSuffix(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

type CreateRoomResponse = { data: { room: { chatId: string } } };
type CreateInvitationResponse = {
  data: { invitation: { id: string; status: 'open' } };
};
type ErrorResponse = { error: { code: string; message: string } };

test.describe('AC-INV-04: a banned user cannot consume a pending invitation', () => {
  test('open invite + landed ban → accept 403 ROOM_BANNED; create-time also blocked', async () => {
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

      // Alice creates private room and invites Bob — invite is open.
      const created = await aliceCtx.post('/rooms', {
        headers: csrfHeaders(aliceSession),
        data: { name: `hold-${suffix}`, visibility: 'private' },
      });
      expect(created.status()).toBe(200);
      const { data: { room } } = (await created.json()) as CreateRoomResponse;

      const invited = await aliceCtx.post(`/rooms/${room.chatId}/invitations`, {
        headers: csrfHeaders(aliceSession),
        data: { inviteeUsername: bob.username },
      });
      expect(invited.status()).toBe(200);
      const { data: { invitation } } = (await invited.json()) as CreateInvitationResponse;

      // Land a ban on Bob directly (simulates the race in which an admin
      // bans the invitee after the invitation was issued but before it's
      // accepted — our moderation endpoint can't produce this state on
      // its own because `remove-as-ban` requires existing membership).
      const landBan = await apiRequest.newContext({ baseURL: 'http://localhost:3000' });
      try {
        const banSeed = await landBan.post('/__test/seed', {
          data: {
            strategy: 'append',
            roomBansByChatId: [
              {
                chatId: room.chatId,
                username: bob.username,
                actorUsername: alice.username,
              },
            ],
          },
        });
        expect(banSeed.status()).toBe(200);
      } finally {
        await landBan.dispose();
      }

      // Accept attempt must be rejected with ROOM_BANNED (AC-INV-04).
      const banned = await bobCtx.post(
        `/rooms/${room.chatId}/invitations/${invitation.id}/accept`,
        { headers: csrfHeaders(bobSession) },
      );
      expect(banned.status()).toBe(403);
      expect(((await banned.json()) as ErrorResponse).error.code).toBe('ROOM_BANNED');

      // The invitation itself is NOT consumed by the failed accept — it
      // stays 'open' so a subsequent unban allows acceptance without
      // needing a new invite. Verify by attempting another accept before
      // unban (still ROOM_BANNED), then after unban (200).
      const bannedAgain = await bobCtx.post(
        `/rooms/${room.chatId}/invitations/${invitation.id}/accept`,
        { headers: csrfHeaders(bobSession) },
      );
      expect(bannedAgain.status()).toBe(403);

      // Create-time guard: Alice cannot issue a *new* invite to Bob while
      // the ban is active (state-model §11.2). Spec: INVITATION_INVALID.
      const secondInviteWhileBanned = await aliceCtx.post(
        `/rooms/${room.chatId}/invitations`,
        {
          headers: csrfHeaders(aliceSession),
          data: { inviteeUsername: bob.username },
        },
      );
      expect(secondInviteWhileBanned.status()).toBe(403);
      expect(((await secondInviteWhileBanned.json()) as ErrorResponse).error.code).toBe(
        'INVITATION_INVALID',
      );

      // Unban and re-accept succeeds on the still-open original invite.
      const unban = await aliceCtx.delete(
        `/rooms/${room.chatId}/bans/${bobSession.userId}`,
        { headers: csrfHeaders(aliceSession) },
      );
      expect(unban.status()).toBe(200);

      const finalAccept = await bobCtx.post(
        `/rooms/${room.chatId}/invitations/${invitation.id}/accept`,
        { headers: csrfHeaders(bobSession) },
      );
      expect(finalAccept.status()).toBe(200);
    } finally {
      await aliceCtx.dispose();
      await bobCtx.dispose();
    }
  });
});

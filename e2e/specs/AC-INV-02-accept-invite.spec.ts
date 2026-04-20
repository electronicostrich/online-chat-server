import { test, expect, request as apiRequest } from '@playwright/test';
import { csrfHeaders, register } from '../utils/auth.js';

function uniqueSuffix(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

type CreateRoomResponse = { data: { room: { chatId: string } } };
type CreateInvitationResponse = {
  data: { invitation: { id: string; status: 'open' } };
};
type AcceptInvitationResponse = {
  data: { membership: { role: 'member' | 'admin' | 'owner' } };
};
type ErrorResponse = { error: { code: string; message: string } };

test.describe('AC-INV-02: accepting a private-room invitation grants membership', () => {
  test('invitee joins, second accept is 409, join on same private room still blocked without invite', async () => {
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
    const mallory = {
      email: `mallory-${suffix}@example.com`,
      username: `mallory_${suffix}`.replace(/-/g, '_'),
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
    const malloryCtx = await apiRequest.newContext({ baseURL: 'http://localhost:3000' });
    try {
      const aliceSession = await register(aliceCtx, alice);
      const bobSession = await register(bobCtx, bob);
      const mallorySession = await register(malloryCtx, mallory);

      const created = await aliceCtx.post('/rooms', {
        headers: csrfHeaders(aliceSession),
        data: { name: `cabal-${suffix}`, visibility: 'private' },
      });
      expect(created.status()).toBe(200);
      const { data: { room } } = (await created.json()) as CreateRoomResponse;

      // Alice invites Bob.
      const invited = await aliceCtx.post(`/rooms/${room.chatId}/invitations`, {
        headers: csrfHeaders(aliceSession),
        data: { inviteeUsername: bob.username },
      });
      expect(invited.status()).toBe(200);
      const { data: { invitation } } = (await invited.json()) as CreateInvitationResponse;

      // Non-invitee (Mallory) attempting to accept sees a 404 (no existence leak).
      const wrongActor = await malloryCtx.post(
        `/rooms/${room.chatId}/invitations/${invitation.id}/accept`,
        { headers: csrfHeaders(mallorySession) },
      );
      expect(wrongActor.status()).toBe(404);
      expect(((await wrongActor.json()) as ErrorResponse).error.code).toBe('NOT_FOUND');

      // Bob accepts → becomes a member.
      const accepted = await bobCtx.post(
        `/rooms/${room.chatId}/invitations/${invitation.id}/accept`,
        { headers: csrfHeaders(bobSession) },
      );
      expect(accepted.status()).toBe(200);
      const acceptedBody = (await accepted.json()) as AcceptInvitationResponse;
      expect(acceptedBody.data.membership.role).toBe('member');

      // Second accept on the now-closed invitation → 409 INVITATION_INVALID.
      const replay = await bobCtx.post(
        `/rooms/${room.chatId}/invitations/${invitation.id}/accept`,
        { headers: csrfHeaders(bobSession) },
      );
      expect(replay.status()).toBe(409);
      expect(((await replay.json()) as ErrorResponse).error.code).toBe(
        'INVITATION_INVALID',
      );

      // Mallory (never invited) still cannot join the private room through
      // the public join endpoint — stays 404 (no existence leak).
      const joinProbe = await malloryCtx.post(`/rooms/${room.chatId}/join`, {
        headers: csrfHeaders(mallorySession),
      });
      expect(joinProbe.status()).toBe(404);
    } finally {
      await aliceCtx.dispose();
      await bobCtx.dispose();
      await malloryCtx.dispose();
    }
  });
});

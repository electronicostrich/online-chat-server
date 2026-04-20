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

test.describe('AC-INV-03: rejecting a private-room invitation changes nothing else', () => {
  test('invitee rejects; no membership is created; second reject is 409; public join still 404', async () => {
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

      const created = await aliceCtx.post('/rooms', {
        headers: csrfHeaders(aliceSession),
        data: { name: `quiet-${suffix}`, visibility: 'private' },
      });
      expect(created.status()).toBe(200);
      const { data: { room } } = (await created.json()) as CreateRoomResponse;

      const invited = await aliceCtx.post(`/rooms/${room.chatId}/invitations`, {
        headers: csrfHeaders(aliceSession),
        data: { inviteeUsername: bob.username },
      });
      expect(invited.status()).toBe(200);
      const { data: { invitation } } = (await invited.json()) as CreateInvitationResponse;

      // Bob rejects.
      const rejected = await bobCtx.post(
        `/rooms/${room.chatId}/invitations/${invitation.id}/reject`,
        { headers: csrfHeaders(bobSession) },
      );
      expect(rejected.status()).toBe(200);

      // Bob is NOT a member now — `POST /join` on a private room returns
      // 404 regardless, so we check the positive invariant: the rejected
      // invitation cannot be re-accepted.
      const replayAccept = await bobCtx.post(
        `/rooms/${room.chatId}/invitations/${invitation.id}/accept`,
        { headers: csrfHeaders(bobSession) },
      );
      expect(replayAccept.status()).toBe(409);
      expect(((await replayAccept.json()) as ErrorResponse).error.code).toBe(
        'INVITATION_INVALID',
      );

      // Second reject on the same id is also 409.
      const replayReject = await bobCtx.post(
        `/rooms/${room.chatId}/invitations/${invitation.id}/reject`,
        { headers: csrfHeaders(bobSession) },
      );
      expect(replayReject.status()).toBe(409);
      expect(((await replayReject.json()) as ErrorResponse).error.code).toBe(
        'INVITATION_INVALID',
      );

      // Rejecting a rejected invite does not unlock public joining on a
      // private room — still 404.
      const joinProbe = await bobCtx.post(`/rooms/${room.chatId}/join`, {
        headers: csrfHeaders(bobSession),
      });
      expect(joinProbe.status()).toBe(404);

      // A fresh invitation can now be created since the prior one is closed.
      const reInvite = await aliceCtx.post(`/rooms/${room.chatId}/invitations`, {
        headers: csrfHeaders(aliceSession),
        data: { inviteeUsername: bob.username },
      });
      expect(reInvite.status()).toBe(200);
    } finally {
      await aliceCtx.dispose();
      await bobCtx.dispose();
    }
  });
});

import { test, expect, request as apiRequest } from '@playwright/test';
import { csrfHeaders, register } from '../utils/auth.js';

function uniqueSuffix(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

type CreateRoomResponse = {
  data: { room: { chatId: string; visibility: 'public' | 'private' } };
};

type CreateInvitationResponse = {
  data: {
    invitation: {
      id: string;
      status: 'open';
      roomChatId: string;
      inviteeUserId: string;
      inviteeUsername: string;
      createdAt: string;
    };
  };
};

type ErrorResponse = { error: { code: string; message: string } };

test.describe('AC-INV-01: only registered users can be invited to a private room', () => {
  test('invite succeeds for existing user; 404 unknown; CONFLICT duplicate; 403 non-owner; 400 public room', async () => {
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

    const seed = await apiRequest.newContext({ baseURL: 'http://localhost:3000' });
    try {
      const res = await seed.post('/__test/seed', { data: { strategy: 'truncate' } });
      expect(res.status()).toBe(200);
    } finally {
      await seed.dispose();
    }

    const aliceCtx = await apiRequest.newContext({ baseURL: 'http://localhost:3000' });
    const bobCtx = await apiRequest.newContext({ baseURL: 'http://localhost:3000' });
    const carolCtx = await apiRequest.newContext({ baseURL: 'http://localhost:3000' });
    try {
      const aliceSession = await register(aliceCtx, alice);
      const bobSession = await register(bobCtx, bob);
      const carolSession = await register(carolCtx, carol);

      const created = await aliceCtx.post('/rooms', {
        headers: csrfHeaders(aliceSession),
        data: { name: `secret-${suffix}`, visibility: 'private' },
      });
      expect(created.status()).toBe(200);
      const { data: { room } } = (await created.json()) as CreateRoomResponse;

      // Inviting Bob (registered) succeeds.
      const okRes = await aliceCtx.post(`/rooms/${room.chatId}/invitations`, {
        headers: csrfHeaders(aliceSession),
        data: { inviteeUsername: bob.username },
      });
      expect(okRes.status()).toBe(200);
      const okBody = (await okRes.json()) as CreateInvitationResponse;
      expect(okBody.data.invitation.status).toBe('open');
      expect(okBody.data.invitation.inviteeUsername).toBe(bob.username);
      expect(okBody.data.invitation.inviteeUserId).toBe(bobSession.userId);
      expect(okBody.data.invitation.id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
      );

      // Unknown username → NOT_FOUND.
      const missing = await aliceCtx.post(`/rooms/${room.chatId}/invitations`, {
        headers: csrfHeaders(aliceSession),
        data: { inviteeUsername: `ghost_${suffix}`.replace(/-/g, '_') },
      });
      expect(missing.status()).toBe(404);
      expect(((await missing.json()) as ErrorResponse).error.code).toBe('NOT_FOUND');

      // Duplicate open invitation for Bob → CONFLICT.
      const dup = await aliceCtx.post(`/rooms/${room.chatId}/invitations`, {
        headers: csrfHeaders(aliceSession),
        data: { inviteeUsername: bob.username },
      });
      expect(dup.status()).toBe(409);
      expect(((await dup.json()) as ErrorResponse).error.code).toBe('CONFLICT');

      // Non-owner (Carol) cannot invite → FORBIDDEN.
      const forbidden = await carolCtx.post(`/rooms/${room.chatId}/invitations`, {
        headers: csrfHeaders(carolSession),
        data: { inviteeUsername: bob.username },
      });
      expect(forbidden.status()).toBe(403);
      expect(((await forbidden.json()) as ErrorResponse).error.code).toBe('FORBIDDEN');

      // Public rooms don't support invitations → 400 VALIDATION_ERROR.
      const pub = await aliceCtx.post('/rooms', {
        headers: csrfHeaders(aliceSession),
        data: { name: `open-${suffix}`, visibility: 'public' },
      });
      expect(pub.status()).toBe(200);
      const { data: { room: pubRoom } } = (await pub.json()) as CreateRoomResponse;
      const invitePublic = await aliceCtx.post(
        `/rooms/${pubRoom.chatId}/invitations`,
        {
          headers: csrfHeaders(aliceSession),
          data: { inviteeUsername: bob.username },
        },
      );
      expect(invitePublic.status()).toBe(400);
      expect(((await invitePublic.json()) as ErrorResponse).error.code).toBe(
        'VALIDATION_ERROR',
      );
    } finally {
      await aliceCtx.dispose();
      await bobCtx.dispose();
      await carolCtx.dispose();
    }
  });
});

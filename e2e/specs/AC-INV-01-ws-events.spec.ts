import { test, expect, request as apiRequest } from '@playwright/test';
import { csrfHeaders, register } from '../utils/auth.js';
import {
  connectWebSocket,
  cookieHeaderFromSetCookie,
  type ReceivedEvent,
} from '../utils/websocket.js';

function uniqueSuffix(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

interface RoomInvitationCreatedPayload {
  invitationId: string;
  room: { chatId: string; name: string };
}

function isInvitationPayload(
  value: unknown,
): value is RoomInvitationCreatedPayload {
  if (typeof value !== 'object' || value === null) return false;
  const r = value as Record<string, unknown>;
  if (typeof r.invitationId !== 'string') return false;
  const room = r.room;
  if (typeof room !== 'object' || room === null) return false;
  const rm = room as Record<string, unknown>;
  return typeof rm.chatId === 'string' && typeof rm.name === 'string';
}

// AC-INV-01 mandates that the invitation event reaches only the invitee.
// The fan-out rule differs from `room.membership.updated` — it is
// targeted, not subscriber-wide, so leaking to unrelated users would
// disclose that a private room even exists.
test.describe('AC-INV-01: room.invitation.created targets invitee only', () => {
  test('invitee receives the event; a bystander subscribed to the room does not', async () => {
    const suffix = uniqueSuffix();
    const ownerUser = {
      email: `inv1ws-owner-${suffix}@example.com`,
      username: `inv1ws_owner_${suffix}`.replace(/-/g, '_'),
      password: 'StrongPassword123!',
    };
    const inviteeUser = {
      email: `inv1ws-inv-${suffix}@example.com`,
      username: `inv1ws_inv_${suffix}`.replace(/-/g, '_'),
      password: 'StrongPassword123!',
    };
    const bystanderUser = {
      email: `inv1ws-bys-${suffix}@example.com`,
      username: `inv1ws_bys_${suffix}`.replace(/-/g, '_'),
      password: 'StrongPassword123!',
    };

    const seed = await apiRequest.newContext({ baseURL: 'http://localhost:3000' });
    try {
      const res = await seed.post('/__test/seed', {
        data: { strategy: 'truncate' },
      });
      expect(res.status()).toBe(200);
    } finally {
      await seed.dispose();
    }

    const ownerCtx = await apiRequest.newContext({ baseURL: 'http://localhost:3000' });
    const inviteeCtx = await apiRequest.newContext({ baseURL: 'http://localhost:3000' });
    const bystanderCtx = await apiRequest.newContext({ baseURL: 'http://localhost:3000' });
    try {
      const ownerSession = await register(ownerCtx, ownerUser);
      const inviteeSession = await register(inviteeCtx, inviteeUser);
      const bystanderSession = await register(bystanderCtx, bystanderUser);

      const roomName = `inv1ws-${suffix}`;
      const create = await ownerCtx.post('/rooms', {
        headers: csrfHeaders(ownerSession),
        data: { name: roomName, visibility: 'private' },
      });
      expect(create.status()).toBe(200);
      const {
        data: { room },
      } = (await create.json()) as { data: { room: { chatId: string } } };

      // Seed the bystander as a member so they can subscribe to the
      // room and prove the invitation event does NOT leak there.
      const bystanderSeed = await apiRequest.newContext({
        baseURL: 'http://localhost:3000',
      });
      try {
        const res = await bystanderSeed.post('/__test/seed', {
          data: {
            strategy: 'append',
            roomMembershipsByChatId: [
              {
                chatId: room.chatId,
                username: bystanderUser.username,
                role: 'member',
              },
            ],
          },
        });
        expect(res.status()).toBe(200);
      } finally {
        await bystanderSeed.dispose();
      }

      const inviteeWs = await connectWebSocket({
        cookieHeader: cookieHeaderFromSetCookie(inviteeSession.response),
      });
      const bystanderWs = await connectWebSocket({
        cookieHeader: cookieHeaderFromSetCookie(bystanderSession.response),
      });
      try {
        // A heartbeat bumps the invitee socket's lastHeartbeatAt so the
        // test-mode 2.5s stale sweep doesn't reap it before the event
        // arrives. The invitee intentionally does NOT subscribe —
        // invitation events target the invitee directly, not the
        // room's subscriber set.
        inviteeWs.send({
          id: 'hb-invitee',
          type: 'presence.heartbeat',
          payload: {},
        });
        bystanderWs.send({
          id: 'sub-byst',
          type: 'chat.subscribe',
          payload: { chatId: room.chatId },
        });
        await bystanderWs.nextEvent((ev) => ev.type === 'chat.subscribe.ack');

        const invite = await ownerCtx.post(`/rooms/${room.chatId}/invitations`, {
          headers: csrfHeaders(ownerSession),
          data: { inviteeUsername: inviteeUser.username },
        });
        expect(invite.status()).toBe(200);

        const matchesInvitation = (ev: ReceivedEvent): boolean =>
          ev.type === 'room.invitation.created' &&
          isInvitationPayload(ev.payload) &&
          ev.payload.room.chatId === room.chatId;

        const inviteEv = await inviteeWs.nextEvent(matchesInvitation, 3_000);
        if (!isInvitationPayload(inviteEv.payload)) {
          throw new Error('invite payload shape mismatch');
        }
        expect(inviteEv.payload.room.name).toBe(roomName);
        expect(inviteEv.payload.invitationId).toMatch(
          /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
        );

        // The bystander must NOT see it. Wait a short beat for any
        // stray event; none should arrive.
        const leak = await Promise.race([
          bystanderWs
            .nextEvent((ev) => ev.type === 'room.invitation.created', 400)
            .then((ev) => ev)
            .catch(() => null),
          new Promise<null>((resolve) => {
            setTimeout(() => {
              resolve(null);
            }, 500);
          }),
        ]);
        expect(leak).toBeNull();
      } finally {
        await inviteeWs.close();
        await bystanderWs.close();
      }
    } finally {
      await ownerCtx.dispose();
      await inviteeCtx.dispose();
      await bystanderCtx.dispose();
    }
  });
});

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

interface RoomMembershipUpdatedPayload {
  chatId: string;
  userId: string;
  membershipState: 'member' | 'left';
  role: 'owner' | 'admin' | 'member';
}

function isMembershipPayload(
  value: unknown,
): value is RoomMembershipUpdatedPayload {
  if (typeof value !== 'object' || value === null) return false;
  const r = value as Record<string, unknown>;
  return (
    typeof r.chatId === 'string' &&
    typeof r.userId === 'string' &&
    typeof r.membershipState === 'string' &&
    typeof r.role === 'string'
  );
}

// AC-MOD-08 explicitly mandates (acceptance-criteria-pack.md §8) that
// promoting a member to admin broadcasts `room.membership.updated` to
// every room subscriber. The spec proves the WS-03 service's post-commit
// event call reaches both the *other* subscribed admin and the promoted
// member's own socket, and that the payload carries `role: "admin"`.
test.describe('AC-MOD-08: make-admin fans out room.membership.updated', () => {
  test('promoted member and other subscribers receive role=admin', async () => {
    const suffix = uniqueSuffix();
    const owner = {
      email: `mod8ws-owner-${suffix}@example.com`,
      username: `mod8ws_owner_${suffix}`.replace(/-/g, '_'),
      password: 'StrongPassword123!',
    };
    const target = {
      email: `mod8ws-target-${suffix}@example.com`,
      username: `mod8ws_target_${suffix}`.replace(/-/g, '_'),
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
    const targetCtx = await apiRequest.newContext({ baseURL: 'http://localhost:3000' });
    try {
      const ownerSession = await register(ownerCtx, owner);
      const targetSession = await register(targetCtx, target);

      const create = await ownerCtx.post('/rooms', {
        headers: csrfHeaders(ownerSession),
        data: { name: `mod8ws-${suffix}`, visibility: 'public' },
      });
      expect(create.status()).toBe(200);
      const {
        data: { room },
      } = (await create.json()) as { data: { room: { chatId: string } } };

      const join = await targetCtx.post(`/rooms/${room.chatId}/join`, {
        headers: csrfHeaders(targetSession),
      });
      expect(join.status()).toBe(200);

      const ownerWs = await connectWebSocket({
        cookieHeader: cookieHeaderFromSetCookie(ownerSession.response),
      });
      const targetWs = await connectWebSocket({
        cookieHeader: cookieHeaderFromSetCookie(targetSession.response),
      });
      try {
        ownerWs.send({
          id: 'sub-owner',
          type: 'chat.subscribe',
          payload: { chatId: room.chatId },
        });
        await ownerWs.nextEvent((ev) => ev.type === 'chat.subscribe.ack');
        targetWs.send({
          id: 'sub-target',
          type: 'chat.subscribe',
          payload: { chatId: room.chatId },
        });
        await targetWs.nextEvent((ev) => ev.type === 'chat.subscribe.ack');

        const promote = await ownerCtx.post(
          `/rooms/${room.chatId}/members/${targetSession.userId}/make-admin`,
          { headers: csrfHeaders(ownerSession) },
        );
        expect(promote.status()).toBe(200);

        const expectRoleAdmin = (ev: ReceivedEvent): boolean =>
          ev.type === 'room.membership.updated' &&
          isMembershipPayload(ev.payload) &&
          ev.payload.chatId === room.chatId &&
          ev.payload.userId === targetSession.userId &&
          ev.payload.role === 'admin' &&
          ev.payload.membershipState === 'member';

        const ownerEv = await ownerWs.nextEvent(expectRoleAdmin, 3_000);
        expect(ownerEv.type).toBe('room.membership.updated');

        const targetEv = await targetWs.nextEvent(expectRoleAdmin, 3_000);
        expect(targetEv.type).toBe('room.membership.updated');
      } finally {
        await ownerWs.close();
        await targetWs.close();
      }
    } finally {
      await ownerCtx.dispose();
      await targetCtx.dispose();
    }
  });
});

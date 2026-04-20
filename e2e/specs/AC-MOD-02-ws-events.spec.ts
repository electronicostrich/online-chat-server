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

interface MembershipPayload {
  chatId: string;
  userId: string;
  membershipState: 'member' | 'left';
  role: 'owner' | 'admin' | 'member';
}
function isMembershipPayload(v: unknown): v is MembershipPayload {
  if (typeof v !== 'object' || v === null) return false;
  const r = v as Record<string, unknown>;
  return (
    typeof r.chatId === 'string' &&
    typeof r.userId === 'string' &&
    typeof r.membershipState === 'string' &&
    typeof r.role === 'string'
  );
}

interface BanPayload {
  chatId: string;
  userId: string;
  isBanned: boolean;
}
function isBanPayload(v: unknown): v is BanPayload {
  if (typeof v !== 'object' || v === null) return false;
  const r = v as Record<string, unknown>;
  return (
    typeof r.chatId === 'string' &&
    typeof r.userId === 'string' &&
    typeof r.isBanned === 'boolean'
  );
}

// AC-MOD-02: `POST /rooms/{id}/members/{uid}/remove` is a "remove-as-ban"
// operation. Per traceability it MUST fan out both
// `room.membership.updated` (role moving out of active) AND
// `room.ban.updated` (isBanned=true). The owner's subscribed socket
// observes both events so a moderation UI can reconcile the member list
// and the ban list in a single pass.
test.describe('AC-MOD-02: remove-as-ban fans out both membership and ban events', () => {
  test('owner receives room.membership.updated and room.ban.updated', async () => {
    const suffix = uniqueSuffix();
    const ownerUser = {
      email: `mod2ws-owner-${suffix}@example.com`,
      username: `mod2ws_owner_${suffix}`.replace(/-/g, '_'),
      password: 'StrongPassword123!',
    };
    const memberUser = {
      email: `mod2ws-member-${suffix}@example.com`,
      username: `mod2ws_member_${suffix}`.replace(/-/g, '_'),
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
    const memberCtx = await apiRequest.newContext({ baseURL: 'http://localhost:3000' });
    try {
      const ownerSession = await register(ownerCtx, ownerUser);
      const memberSession = await register(memberCtx, memberUser);

      const create = await ownerCtx.post('/rooms', {
        headers: csrfHeaders(ownerSession),
        data: { name: `mod2ws-${suffix}`, visibility: 'public' },
      });
      expect(create.status()).toBe(200);
      const {
        data: { room },
      } = (await create.json()) as { data: { room: { chatId: string } } };

      const join = await memberCtx.post(`/rooms/${room.chatId}/join`, {
        headers: csrfHeaders(memberSession),
      });
      expect(join.status()).toBe(200);

      const ownerWs = await connectWebSocket({
        cookieHeader: cookieHeaderFromSetCookie(ownerSession.response),
      });
      try {
        ownerWs.send({
          id: 'sub-owner',
          type: 'chat.subscribe',
          payload: { chatId: room.chatId },
        });
        await ownerWs.nextEvent((ev) => ev.type === 'chat.subscribe.ack');
        // One more heartbeat immediately before the HTTP call resets
        // the server's stale clock for this tab; test-mode shrinks
        // `WEBSOCKET_STALE_TIMEOUT_MS` to 2.5s and the POST path can
        // straddle that window on a loaded runner.
        ownerWs.send({
          id: 'hb-owner',
          type: 'presence.heartbeat',
          payload: {},
        });

        const remove = await ownerCtx.post(
          `/rooms/${room.chatId}/members/${memberSession.userId}/remove`,
          { headers: csrfHeaders(ownerSession) },
        );
        expect(remove.status()).toBe(200);

        const matchesMembershipLeft = (ev: ReceivedEvent): boolean =>
          ev.type === 'room.membership.updated' &&
          isMembershipPayload(ev.payload) &&
          ev.payload.chatId === room.chatId &&
          ev.payload.userId === memberSession.userId &&
          ev.payload.membershipState === 'left';

        const matchesBanAdded = (ev: ReceivedEvent): boolean =>
          ev.type === 'room.ban.updated' &&
          isBanPayload(ev.payload) &&
          ev.payload.chatId === room.chatId &&
          ev.payload.userId === memberSession.userId &&
          ev.payload.isBanned;

        const membershipEv = await ownerWs.nextEvent(
          matchesMembershipLeft,
          3_000,
        );
        expect(membershipEv.type).toBe('room.membership.updated');
        const banEv = await ownerWs.nextEvent(matchesBanAdded, 3_000);
        expect(banEv.type).toBe('room.ban.updated');
      } finally {
        await ownerWs.close();
      }
    } finally {
      await ownerCtx.dispose();
      await memberCtx.dispose();
    }
  });
});

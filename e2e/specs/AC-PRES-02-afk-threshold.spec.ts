import { test, expect, request as apiRequest } from '@playwright/test';
import { register } from '../utils/auth.js';
import { connectWebSocket, cookieHeaderFromSetCookie } from '../utils/websocket.js';

function uniqueSuffix(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function isPresencePayload(
  value: unknown,
): value is { userId: string; presence: 'online' | 'afk' | 'offline' } {
  if (typeof value !== 'object' || value === null) return false;
  const rec = value as Record<string, unknown>;
  return typeof rec.userId === 'string' && typeof rec.presence === 'string';
}

// AC-PRES-02: when all of a user's live tabs go without activity for
// the AFK threshold (60s product default; compressed in compose.test.yaml
// to 1.5s so the suite doesn't block), presence transitions online →
// afk. The subject below doesn't emit `presence.activity`, and the
// gateway-level activity bump only fires on the initial connect, so
// after the threshold elapses the sweep MUST publish an AFK event.
test.describe('AC-PRES-02: afk after AFK threshold', () => {
  test('idle subject transitions to afk, observed by friend', async () => {
    const suffix = uniqueSuffix();
    const observer = {
      email: `pres2-obs-${suffix}@example.com`,
      username: `pres2_obs_${suffix}`.replace(/-/g, '_'),
      password: 'StrongPassword123!',
    };
    const subject = {
      email: `pres2-sub-${suffix}@example.com`,
      username: `pres2_sub_${suffix}`.replace(/-/g, '_'),
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

    const obsCtx = await apiRequest.newContext({ baseURL: 'http://localhost:3000' });
    const subCtx = await apiRequest.newContext({ baseURL: 'http://localhost:3000' });
    try {
      const obsSession = await register(obsCtx, observer);
      const subSession = await register(subCtx, subject);
      const subjectUserId = subSession.userId;

      const friendSeed = await apiRequest.newContext({
        baseURL: 'http://localhost:3000',
      });
      try {
        const f = await friendSeed.post('/__test/seed', {
          data: {
            strategy: 'append',
            friendships: [{ userA: observer.username, userB: subject.username }],
          },
        });
        expect(f.status()).toBe(200);
      } finally {
        await friendSeed.dispose();
      }

      const obsCookie = cookieHeaderFromSetCookie(obsSession.response);
      const obsWs = await connectWebSocket({ cookieHeader: obsCookie });
      try {
        const subCookie = cookieHeaderFromSetCookie(subSession.response);
        // Heartbeat every 500ms so the socket does NOT go stale —
        // AC-PRES-04's stale threshold is separate. The subject stays
        // connected but idle (no `presence.activity`) so only the AFK
        // transition fires.
        const sub = await connectWebSocket({ cookieHeader: subCookie });
        try {
          const hbTimer = setInterval(() => {
            sub.send({ id: 'hb', type: 'presence.heartbeat', payload: {} });
          }, 500);
          try {
            const online = await obsWs.nextEvent(
              (ev) =>
                ev.type === 'presence.updated' &&
                isPresencePayload(ev.payload) &&
                ev.payload.userId === subjectUserId &&
                ev.payload.presence === 'online',
              3_000,
            );
            expect((online.payload as { presence: string }).presence).toBe(
              'online',
            );

            // Wait past the compressed AFK threshold (1.5s) + one scan
            // interval (250ms) with margin. The sweep MUST flip the
            // subject to afk because `presence.heartbeat` keeps the
            // socket alive but never claims activity.
            const afk = await obsWs.nextEvent(
              (ev) =>
                ev.type === 'presence.updated' &&
                isPresencePayload(ev.payload) &&
                ev.payload.userId === subjectUserId &&
                ev.payload.presence === 'afk',
              5_000,
            );
            expect((afk.payload as { presence: string }).presence).toBe('afk');
          } finally {
            clearInterval(hbTimer);
          }
        } finally {
          await sub.close();
        }
      } finally {
        await obsWs.close();
      }
    } finally {
      await obsCtx.dispose();
      await subCtx.dispose();
    }
  });
});


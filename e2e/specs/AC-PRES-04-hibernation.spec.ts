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

// AC-PRES-04: a hibernated browser tab stops sending heartbeats. The
// periodic presence scan MUST flag the socket stale once the stale
// threshold elapses, close it with STALE_CONNECTION (4410), and
// aggregate the subject down to offline once no live tab remains.
// Compose-level thresholds compress the product's 45s to 2.5s so the
// suite can assert this in realistic test time.
test.describe('AC-PRES-04: hibernated tab eventually marked offline', () => {
  test('stale tab is closed by server sweep and subject observed offline', async () => {
    const suffix = uniqueSuffix();
    const observer = {
      email: `pres4-obs-${suffix}@example.com`,
      username: `pres4_obs_${suffix}`.replace(/-/g, '_'),
      password: 'StrongPassword123!',
    };
    const subject = {
      email: `pres4-sub-${suffix}@example.com`,
      username: `pres4_sub_${suffix}`.replace(/-/g, '_'),
      password: 'StrongPassword123!',
    };

    const seed = await apiRequest.newContext({ baseURL: 'http://localhost:3000' });
    try {
      const res = await seed.post('/__test/seed', { data: { strategy: 'truncate' } });
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
      // The observer's socket would itself go stale inside the 8s
      // window — it also has to heartbeat to stay registered. Only
      // the SUBJECT goes silent in this scenario; the observer is a
      // fully-live client.
      const obsHeartbeat = setInterval(() => {
        obsWs.send({ id: 'obs-hb', type: 'presence.heartbeat', payload: {} });
      }, 500);
      try {
        const subCookie = cookieHeaderFromSetCookie(subSession.response);
        // Subject connects ONCE and then goes silent — mimicking a
        // hibernated tab. No `presence.heartbeat` / `presence.activity`
        // / anything follows, so `lastHeartbeatAt` stays pinned to the
        // connect time.
        const sub = await connectWebSocket({ cookieHeader: subCookie });

        const online = await obsWs.nextEvent(
          (ev) =>
            ev.type === 'presence.updated' &&
            isPresencePayload(ev.payload) &&
            ev.payload.userId === subjectUserId &&
            ev.payload.presence === 'online',
          3_000,
        );
        expect((online.payload as { presence: string }).presence).toBe('online');

        // Wait for the sweep to flag the socket stale and drop
        // subject to offline. Compressed threshold is 2.5s + 250ms
        // scan interval; 5s cap leaves margin for CI scheduler jitter.
        const offline = await obsWs.nextEvent(
          (ev) =>
            ev.type === 'presence.updated' &&
            isPresencePayload(ev.payload) &&
            ev.payload.userId === subjectUserId &&
            ev.payload.presence === 'offline',
          8_000,
        );
        expect((offline.payload as { presence: string }).presence).toBe('offline');

        // The server closed the stale socket with code 4410. The
        // underlying `ws` client surfaces the code through `closeInfo`
        // once the `close` frame is received.
        await new Promise<void>((resolve) => {
          const check = (): void => {
            const info = sub.closeInfo();
            if (info !== undefined) {
              resolve();
              return;
            }
            setTimeout(check, 100);
          };
          check();
        });
        expect(sub.closeInfo()?.code).toBe(4410);
      } finally {
        clearInterval(obsHeartbeat);
        await obsWs.close();
      }
    } finally {
      await obsCtx.dispose();
      await subCtx.dispose();
    }
  });
});

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

// AC-PRES-03: when every live tab disconnects, the user aggregates as
// offline. This spec closes the single live connection explicitly and
// expects the observer to receive `presence.updated: offline`. The
// socket close path is what fires the transition — the sweep is
// exercised by AC-PRES-04.
test.describe('AC-PRES-03: offline after all tabs disconnect', () => {
  test('closing the only tab fans offline event to friend observer', async () => {
    const suffix = uniqueSuffix();
    const observer = {
      email: `pres3-obs-${suffix}@example.com`,
      username: `pres3_obs_${suffix}`.replace(/-/g, '_'),
      password: 'StrongPassword123!',
    };
    const subject = {
      email: `pres3-sub-${suffix}@example.com`,
      username: `pres3_sub_${suffix}`.replace(/-/g, '_'),
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
      // Declared outside the try so the outer finally can tear it
      // down if an assertion throws mid-test.
      let sub: Awaited<ReturnType<typeof connectWebSocket>> | undefined;
      try {
        const subCookie = cookieHeaderFromSetCookie(subSession.response);
        sub = await connectWebSocket({ cookieHeader: subCookie });

        const online = await obsWs.nextEvent(
          (ev) =>
            ev.type === 'presence.updated' &&
            isPresencePayload(ev.payload) &&
            ev.payload.userId === subjectUserId &&
            ev.payload.presence === 'online',
          3_000,
        );
        expect((online.payload as { presence: string }).presence).toBe('online');

        await sub.close();
        sub = undefined;
        const offline = await obsWs.nextEvent(
          (ev) =>
            ev.type === 'presence.updated' &&
            isPresencePayload(ev.payload) &&
            ev.payload.userId === subjectUserId &&
            ev.payload.presence === 'offline',
          3_000,
        );
        expect((offline.payload as { presence: string }).presence).toBe('offline');
      } finally {
        if (sub !== undefined) await sub.close().catch(() => undefined);
        await obsWs.close();
      }
    } finally {
      await obsCtx.dispose();
      await subCtx.dispose();
    }
  });
});

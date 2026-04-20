import { test, expect, request as apiRequest } from '@playwright/test';
import { register } from '../utils/auth.js';
import {
  connectWebSocket,
  cookieHeaderFromSetCookie,
  type ReceivedEvent,
} from '../utils/websocket.js';

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

async function waitPresenceFor(
  ws: { nextEvent: (p: (e: ReceivedEvent) => boolean, ms?: number) => Promise<ReceivedEvent> },
  subjectUserId: string,
  state: 'online' | 'afk' | 'offline',
  timeoutMs: number,
): Promise<ReceivedEvent> {
  return ws.nextEvent(
    (ev) =>
      ev.type === 'presence.updated' &&
      isPresencePayload(ev.payload) &&
      ev.payload.userId === subjectUserId &&
      ev.payload.presence === state,
    timeoutMs,
  );
}

// AC-PRES-01: presence is an *aggregate* per user. If any live tab is
// active the user is `online`. Closing one of multiple active tabs MUST
// NOT flip presence to offline — only the last tab going away does.
// Observer in this spec is a friend; per permissions-matrix.md §4 that
// is one of the two views permitted to see presence.
test.describe('AC-PRES-01: multi-tab presence stays online', () => {
  test('closing one of two tabs keeps subject online; closing the last flips offline', async () => {
    const suffix = uniqueSuffix();
    const observer = {
      email: `pres1-obs-${suffix}@example.com`,
      username: `pres1_obs_${suffix}`.replace(/-/g, '_'),
      password: 'StrongPassword123!',
    };
    const subject = {
      email: `pres1-sub-${suffix}@example.com`,
      username: `pres1_sub_${suffix}`.replace(/-/g, '_'),
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
    const subCtx1 = await apiRequest.newContext({ baseURL: 'http://localhost:3000' });
    const subCtx2 = await apiRequest.newContext({ baseURL: 'http://localhost:3000' });
    try {
      const obsSession = await register(obsCtx, observer);
      const subSession1 = await register(subCtx1, subject);
      const subjectUserId = subSession1.userId;

      // Second tab = second login under the same account. Each login
      // mints an independent session so /auth/logout etc. doesn't tear
      // down the other tab — same as the real product does for two
      // browser tabs in one profile.
      const login2 = await subCtx2.post('/auth/login', {
        data: { email: subject.email, password: subject.password },
      });
      expect(login2.status()).toBe(200);

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
      // Declare subject tabs outside the try so the outer finally can
      // tear them down even if an intermediate assertion throws —
      // otherwise a failing spec would leak presence state into the
      // next test in the serial suite.
      let tab1: Awaited<ReturnType<typeof connectWebSocket>> | undefined;
      let tab2: Awaited<ReturnType<typeof connectWebSocket>> | undefined;
      try {
        const subCookie1 = cookieHeaderFromSetCookie(subSession1.response);
        const subCookie2 = cookieHeaderFromSetCookie(login2);

        // Tab 1 opens: subject flips offline → online. Observer MUST
        // see the event.
        tab1 = await connectWebSocket({ cookieHeader: subCookie1 });
        await waitPresenceFor(obsWs, subjectUserId, 'online', 3_000);

        // Tab 2 opens: aggregate stays online, so observer MUST NOT
        // receive a duplicate event within a short window.
        tab2 = await connectWebSocket({ cookieHeader: subCookie2 });
        const spuriousAfterTab2 = await Promise.race([
          obsWs
            .nextEvent(
              (ev) =>
                ev.type === 'presence.updated' &&
                isPresencePayload(ev.payload) &&
                ev.payload.userId === subjectUserId,
              400,
            )
            .then((ev) => ev)
            .catch(() => null),
          new Promise<null>((resolve) => {
            setTimeout(() => {
              resolve(null);
            }, 500);
          }),
        ]);
        expect(spuriousAfterTab2).toBeNull();

        // Close tab 1: tab 2 still live with recent activity, so
        // aggregate stays online. Observer MUST NOT receive an event.
        await tab1.close();
        tab1 = undefined;
        const spuriousAfterClose1 = await Promise.race([
          obsWs
            .nextEvent(
              (ev) =>
                ev.type === 'presence.updated' &&
                isPresencePayload(ev.payload) &&
                ev.payload.userId === subjectUserId,
              400,
            )
            .then((ev) => ev)
            .catch(() => null),
          new Promise<null>((resolve) => {
            setTimeout(() => {
              resolve(null);
            }, 500);
          }),
        ]);
        expect(spuriousAfterClose1).toBeNull();

        // Close tab 2: no live tabs remain, so aggregate flips to
        // offline. Observer MUST see the event.
        await tab2.close();
        tab2 = undefined;
        const offline = await waitPresenceFor(obsWs, subjectUserId, 'offline', 3_000);
        expect(offline.type).toBe('presence.updated');
      } finally {
        if (tab1 !== undefined) await tab1.close().catch(() => undefined);
        if (tab2 !== undefined) await tab2.close().catch(() => undefined);
        await obsWs.close();
      }
    } finally {
      await obsCtx.dispose();
      await subCtx1.dispose();
      await subCtx2.dispose();
    }
  });
});

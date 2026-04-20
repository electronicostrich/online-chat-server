import { test, expect, request as apiRequest } from '@playwright/test';
import { csrfHeaders, login, register } from '../utils/auth.js';
import {
  connectWebSocket,
  cookieHeaderFromSetCookie,
  type ReceivedEvent,
} from '../utils/websocket.js';

function uniqueSuffix(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

// AC-AUTH-04 (WS portion): `POST /auth/logout` revokes the caller's
// session. `publishSessionRevoked` then delivers `session.revoked` to
// every live socket bound to that session and closes each with WS
// close code 4440 (SESSION_REVOKED). A second session of the same
// user (tab B) is unaffected.
//
// The HTTP-layer AC-AUTH-04 spec (`AC-AUTH-04-logout-scope.spec.ts`)
// already proves the cookie-clearing + scoping behaviour; this spec
// is the WS complement, matching the pattern established by
// `AC-AUTH-06-ws-drop.spec.ts` for the logout-session path.
test.describe('AC-AUTH-04: self-logout drops own live socket', () => {
  test("self /auth/logout fires session.revoked + closes caller's socket only", async () => {
    const suffix = uniqueSuffix();
    const user = {
      email: `auth04ws-${suffix}@example.com`,
      username: `auth04ws_${suffix}`.replace(/-/g, '_'),
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

    const tabA = await apiRequest.newContext({ baseURL: 'http://localhost:3000' });
    const tabB = await apiRequest.newContext({ baseURL: 'http://localhost:3000' });
    try {
      const sessA = await register(tabA, user);
      const sessB = await login(tabB, {
        email: user.email,
        password: user.password,
      });
      expect(sessA.sessionId).not.toBe(sessB.sessionId);

      const wsA = await connectWebSocket({
        cookieHeader: cookieHeaderFromSetCookie(sessA.response),
      });
      const wsB = await connectWebSocket({
        cookieHeader: cookieHeaderFromSetCookie(sessB.response),
      });

      try {
        // Wire up the close + event observers before the HTTP call so
        // a fast-close from the server cannot race past the listener.
        const aClosed = new Promise<number>((resolve) => {
          wsA.ws.once('close', (code) => {
            resolve(code);
          });
        });
        const aGotEvent = wsA.nextEvent(
          (ev) => ev.type === 'session.revoked',
          5_000,
        );

        const res = await tabA.post('/auth/logout', {
          headers: csrfHeaders(sessA),
        });
        expect(res.status()).toBe(200);

        const evt = (await aGotEvent) as ReceivedEvent & {
          payload: { sessionId: string };
        };
        expect(evt.payload.sessionId).toBe(sessA.sessionId);

        const closeCode = await Promise.race([
          aClosed,
          new Promise<number>((_, rej) =>
            setTimeout(() => {
              rej(new Error('timeout waiting for ws close'));
            }, 5_000),
          ),
        ]);
        expect(closeCode).toBe(4440);

        // Tab B's socket must still be open — the revocation is
        // scoped to the caller's own session id, not every session
        // the user holds.
        expect(wsB.ws.readyState).toBe(wsB.ws.OPEN);
      } finally {
        await wsA.close();
        await wsB.close();
      }
    } finally {
      await tabA.dispose();
      await tabB.dispose();
    }
  });
});

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

// AC-AUTH-06 (WS portion): revoking a session via
// POST /auth/logout-session fans out a `session.revoked` event to the
// revoked session's live socket and then closes that socket with code
// 4440 (SESSION_REVOKED). Other sessions of the same user remain up.
test.describe('AC-AUTH-06: live-socket drop on session revocation', () => {
  test('revoked session\'s socket receives session.revoked and closes; sibling socket stays up', async () => {
    const suffix = uniqueSuffix();
    const user = {
      email: `auth06-${suffix}@example.com`,
      username: `auth06_${suffix}`.replace(/-/g, '_'),
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
        // Observe B's close code via a promise wired before the revoke,
        // so we catch it even if the server closes instantly.
        const bClosed = new Promise<number>((resolve) => {
          wsB.ws.once('close', (code) => {
            resolve(code);
          });
        });

        // Also listen for the session.revoked event on B.
        const bGotEvent = wsB.nextEvent(
          (ev) => ev.type === 'session.revoked',
          5_000,
        );

        // Tab A revokes tab B's session (cross-session, same user).
        const res = await tabA.post('/auth/logout-session', {
          headers: csrfHeaders(sessA),
          data: { sessionId: sessB.sessionId },
        });
        expect(res.status()).toBe(200);

        const evt = (await bGotEvent) as ReceivedEvent & {
          payload: { sessionId: string };
        };
        expect(evt.payload.sessionId).toBe(sessB.sessionId);

        const closeCode = await Promise.race([
          bClosed,
          new Promise<number>((_, rej) =>
            setTimeout(() => {
              rej(new Error('timeout waiting for ws close'));
            }, 5_000),
          ),
        ]);
        expect(closeCode).toBe(4440);

        // Tab A's socket must still be open — the revocation is
        // targeted at B's session only.
        expect(wsA.ws.readyState).toBe(wsA.ws.OPEN);
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

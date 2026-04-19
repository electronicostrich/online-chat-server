import { test, expect, request as apiRequest } from '@playwright/test';
import { csrfHeaders, login } from '../utils/auth.js';

function uniqueSuffix(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

type SessionsResponse = {
  data: { sessions: { id: string; current: boolean }[] };
};

test.describe('AC-AUTH-06: revoking another session takes effect immediately', () => {
  test('POST /auth/logout-session invalidates the target session for subsequent API calls', async () => {
    const suffix = uniqueSuffix();
    const username = `alice_${suffix}`.replace(/-/g, '_');
    const email = `alice-${suffix}@example.com`;
    const password = 'StrongPassword123!';

    const seedApi = await apiRequest.newContext({ baseURL: 'http://localhost:3000' });
    try {
      await seedApi.post('/__test/seed', {
        data: {
          strategy: 'truncate',
          users: [{ username, email, password }],
        },
      });
    } finally {
      await seedApi.dispose();
    }

    const tabA = await apiRequest.newContext({ baseURL: 'http://localhost:3000' });
    const tabB = await apiRequest.newContext({ baseURL: 'http://localhost:3000' });
    try {
      const a = await login(tabA, { email, password });
      const b = await login(tabB, { email, password });

      // Before revocation, B can read its own sessions.
      const preCheck = await tabB.get('/sessions');
      expect(preCheck.status()).toBe(200);

      const revoke = await tabA.post('/auth/logout-session', {
        headers: csrfHeaders(a),
        data: { sessionId: b.sessionId },
      });
      expect(revoke.status()).toBe(200);

      // Tab B's next authenticated call must fail because its session is gone.
      const postCheck = await tabB.get('/sessions');
      expect(postCheck.status()).toBe(401);

      // Tab A is unaffected; the list it sees no longer includes B.
      const aList = await tabA.get('/sessions');
      expect(aList.status()).toBe(200);
      const body = (await aList.json()) as SessionsResponse;
      const ids = body.data.sessions.map((s) => s.id);
      expect(ids).toContain(a.sessionId);
      expect(ids).not.toContain(b.sessionId);
    } finally {
      await tabA.dispose();
      await tabB.dispose();
    }
  });

  test('cannot revoke a session belonging to another user', async () => {
    const suffix = uniqueSuffix();
    const alice = {
      username: `alice_${suffix}`.replace(/-/g, '_'),
      email: `alice-${suffix}@example.com`,
      password: 'StrongPassword123!',
    };
    const mallory = {
      username: `mallory_${suffix}`.replace(/-/g, '_'),
      email: `mallory-${suffix}@example.com`,
      password: 'StrongPassword123!',
    };

    const seedApi = await apiRequest.newContext({ baseURL: 'http://localhost:3000' });
    try {
      await seedApi.post('/__test/seed', {
        data: { strategy: 'truncate', users: [alice, mallory] },
      });
    } finally {
      await seedApi.dispose();
    }

    const aliceApi = await apiRequest.newContext({ baseURL: 'http://localhost:3000' });
    const malloryApi = await apiRequest.newContext({
      baseURL: 'http://localhost:3000',
    });
    try {
      const aliceSession = await login(aliceApi, {
        email: alice.email,
        password: alice.password,
      });
      const mallorySession = await login(malloryApi, {
        email: mallory.email,
        password: mallory.password,
      });

      const attack = await malloryApi.post('/auth/logout-session', {
        headers: csrfHeaders(mallorySession),
        data: { sessionId: aliceSession.sessionId },
      });
      // Server responds 404 — the session exists but not for this caller;
      // leaking its existence via 403 vs 404 is worse than hiding it.
      expect(attack.status()).toBe(404);

      // Alice's session still works.
      const aliceList = await aliceApi.get('/sessions');
      expect(aliceList.status()).toBe(200);
    } finally {
      await aliceApi.dispose();
      await malloryApi.dispose();
    }
  });
});

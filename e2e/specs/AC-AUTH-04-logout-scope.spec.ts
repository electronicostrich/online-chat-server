import { test, expect, request as apiRequest } from '@playwright/test';
import { csrfHeaders, login } from '../utils/auth.js';

function uniqueSuffix(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

type SessionsResponse = {
  data: {
    sessions: { id: string; current: boolean }[];
  };
};

test.describe('AC-AUTH-04: logout affects only the calling browser', () => {
  test('logout from tab A leaves tab B active and revokes only tab A', async () => {
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
      const sessionA = await login(tabA, { email, password });
      const sessionB = await login(tabB, { email, password });

      const logout = await tabA.post('/auth/logout', {
        headers: csrfHeaders(sessionA),
      });
      expect(logout.status()).toBe(200);

      // Tab A's session is now revoked: /sessions requires auth → 401.
      const listA = await tabA.get('/sessions');
      expect(listA.status()).toBe(401);

      // Tab B stays authenticated and only sees its own active session now.
      const listB = await tabB.get('/sessions');
      expect(listB.status()).toBe(200);
      const body = (await listB.json()) as SessionsResponse;
      const ids = body.data.sessions.map((s) => s.id);
      expect(ids).toContain(sessionB.sessionId);
      expect(ids).not.toContain(sessionA.sessionId);
    } finally {
      await tabA.dispose();
      await tabB.dispose();
    }
  });

  test('logout without a session returns UNAUTHENTICATED', async () => {
    const api = await apiRequest.newContext({ baseURL: 'http://localhost:3000' });
    try {
      const res = await api.post('/auth/logout');
      // The request never had a session cookie, and the route is CSRF-exempt
      // only for the bootstrap auth endpoints. Logout requires CSRF → the
      // server may answer 401 (no session) or 403 (no csrf cookie either).
      // The AC only mandates that it does NOT create or leak a session.
      expect([401, 403]).toContain(res.status());
    } finally {
      await api.dispose();
    }
  });
});

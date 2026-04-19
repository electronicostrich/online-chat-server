import { test, expect, request as apiRequest } from '@playwright/test';

type LoginResponse = {
  data: {
    user: { id: string; username: string };
    session: { id: string; createdAt: string };
  };
};

type SessionsResponse = {
  data: {
    sessions: {
      id: string;
      current: boolean;
      userAgent: string | null;
      ipAddress: string | null;
      createdAt: string;
      lastSeenAt: string;
    }[];
  };
};

function uniqueSuffix(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

test.describe('AC-AUTH-03: login creates one active session per browser', () => {
  test('successful login issues a session cookie and leaves prior sessions untouched', async () => {
    const suffix = uniqueSuffix();
    const username = `alice_${suffix}`.replace(/-/g, '_');
    const email = `alice-${suffix}@example.com`;
    const password = 'StrongPassword123!';

    const seedApi = await apiRequest.newContext({
      baseURL: 'http://localhost:3000',
    });
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

    // Tab A logs in from one context.
    const tabA = await apiRequest.newContext({ baseURL: 'http://localhost:3000' });
    // Tab B is an entirely fresh context (different cookie jar), simulating
    // a different browser.
    const tabB = await apiRequest.newContext({ baseURL: 'http://localhost:3000' });
    try {
      const loginA = await tabA.post('/auth/login', {
        data: { email, password },
      });
      expect(loginA.status()).toBe(200);
      const bodyA = (await loginA.json()) as LoginResponse;
      expect(bodyA.data.user.username).toBe(username);
      const sessionAId = bodyA.data.session.id;

      const loginB = await tabB.post('/auth/login', {
        data: { email, password },
      });
      expect(loginB.status()).toBe(200);
      const bodyB = (await loginB.json()) as LoginResponse;
      const sessionBId = bodyB.data.session.id;
      expect(sessionBId).not.toBe(sessionAId);

      // From tab A's cookie jar, /sessions must show both sessions active,
      // with tab A's own session flagged current.
      const listRes = await tabA.get('/sessions');
      expect(listRes.status()).toBe(200);
      const list = (await listRes.json()) as SessionsResponse;
      const ids = list.data.sessions.map((s) => s.id);
      expect(ids).toContain(sessionAId);
      expect(ids).toContain(sessionBId);
      const current = list.data.sessions.find((s) => s.current);
      expect(current?.id).toBe(sessionAId);
    } finally {
      await tabA.dispose();
      await tabB.dispose();
    }
  });

  test('wrong password returns UNAUTHENTICATED without issuing a session', async () => {
    const suffix = uniqueSuffix();
    const username = `bob_${suffix}`.replace(/-/g, '_');
    const email = `bob-${suffix}@example.com`;
    const password = 'StrongPassword123!';

    const seedApi = await apiRequest.newContext({
      baseURL: 'http://localhost:3000',
    });
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

    const api = await apiRequest.newContext({ baseURL: 'http://localhost:3000' });
    try {
      const res = await api.post('/auth/login', {
        data: { email, password: 'WrongPassword9!!' },
      });
      expect(res.status()).toBe(401);
      const body = (await res.json()) as { error: { code: string } };
      expect(body.error.code).toBe('UNAUTHENTICATED');
      const setCookie = res.headers()['set-cookie'] ?? '';
      expect(setCookie).not.toContain('chat_sid=');
    } finally {
      await api.dispose();
    }
  });
});

import { test, expect, request as apiRequest } from '@playwright/test';
import { login } from '../utils/auth.js';

function uniqueSuffix(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

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

test.describe('AC-AUTH-05: /sessions lists the caller\'s active sessions with metadata', () => {
  test('lists all of the caller\'s sessions with exactly one flagged current', async () => {
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

    const tabA = await apiRequest.newContext({
      baseURL: 'http://localhost:3000',
      userAgent: 'ACAuth05TabA/1.0',
    });
    const tabB = await apiRequest.newContext({
      baseURL: 'http://localhost:3000',
      userAgent: 'ACAuth05TabB/1.0',
    });
    const tabC = await apiRequest.newContext({
      baseURL: 'http://localhost:3000',
      userAgent: 'ACAuth05TabC/1.0',
    });
    try {
      const a = await login(tabA, { email, password });
      const b = await login(tabB, { email, password });
      const c = await login(tabC, { email, password });

      const listRes = await tabA.get('/sessions');
      expect(listRes.status()).toBe(200);
      const body = (await listRes.json()) as SessionsResponse;

      const ids = body.data.sessions.map((s) => s.id);
      expect(ids).toEqual(expect.arrayContaining([a.sessionId, b.sessionId, c.sessionId]));
      expect(body.data.sessions).toHaveLength(3);

      const currents = body.data.sessions.filter((s) => s.current);
      expect(currents).toHaveLength(1);
      expect(currents[0]?.id).toBe(a.sessionId);

      for (const s of body.data.sessions) {
        expect(s.userAgent).not.toBeNull();
        expect(s.ipAddress).not.toBeNull();
        expect(new Date(s.createdAt).getTime()).toBeGreaterThan(0);
        expect(new Date(s.lastSeenAt).getTime()).toBeGreaterThan(0);
      }
    } finally {
      await tabA.dispose();
      await tabB.dispose();
      await tabC.dispose();
    }
  });

  test('does not leak another user\'s sessions', async () => {
    const suffix = uniqueSuffix();
    const alice = {
      username: `alice_${suffix}`.replace(/-/g, '_'),
      email: `alice-${suffix}@example.com`,
      password: 'StrongPassword123!',
    };
    const bob = {
      username: `bob_${suffix}`.replace(/-/g, '_'),
      email: `bob-${suffix}@example.com`,
      password: 'StrongPassword123!',
    };

    const seedApi = await apiRequest.newContext({ baseURL: 'http://localhost:3000' });
    try {
      await seedApi.post('/__test/seed', {
        data: { strategy: 'truncate', users: [alice, bob] },
      });
    } finally {
      await seedApi.dispose();
    }

    const aliceApi = await apiRequest.newContext({ baseURL: 'http://localhost:3000' });
    const bobApi = await apiRequest.newContext({ baseURL: 'http://localhost:3000' });
    try {
      const aliceSession = await login(aliceApi, {
        email: alice.email,
        password: alice.password,
      });
      const bobSession = await login(bobApi, {
        email: bob.email,
        password: bob.password,
      });

      const aliceList = await aliceApi.get('/sessions');
      expect(aliceList.status()).toBe(200);
      const aliceBody = (await aliceList.json()) as SessionsResponse;
      const aliceIds = aliceBody.data.sessions.map((s) => s.id);
      expect(aliceIds).toContain(aliceSession.sessionId);
      expect(aliceIds).not.toContain(bobSession.sessionId);

      const bobList = await bobApi.get('/sessions');
      expect(bobList.status()).toBe(200);
      const bobBody = (await bobList.json()) as SessionsResponse;
      const bobIds = bobBody.data.sessions.map((s) => s.id);
      expect(bobIds).toContain(bobSession.sessionId);
      expect(bobIds).not.toContain(aliceSession.sessionId);
    } finally {
      await aliceApi.dispose();
      await bobApi.dispose();
    }
  });
});

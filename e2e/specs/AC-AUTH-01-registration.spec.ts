import { test, expect, request as apiRequest } from '@playwright/test';

type RegisterResponse = {
  data: {
    user: { id: string; email: string; username: string };
    session: { id: string; createdAt: string };
  };
};

type SeedResponse = {
  data: { createdIds: { users: Record<string, string> } };
};

type ErrorResponse = {
  error: { code: string; message: string };
};

function uniqueSuffix(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

test.describe('AC-AUTH-01: registration with unique credentials', () => {
  test('creates an active account, stores hashed password, issues session cookie', async () => {
    const api = await apiRequest.newContext({ baseURL: 'http://localhost:3000' });
    try {
      await api.post('/__test/seed', {
        data: { strategy: 'truncate', users: [] },
      });

      const suffix = uniqueSuffix();
      const email = `alice-${suffix}@example.com`;
      const username = `alice_${suffix}`.replace(/-/g, '_');
      const password = 'StrongPassword123!';

      const res = await api.post('/auth/register', {
        data: { email, username, password },
      });
      expect(res.status()).toBe(200);

      const body = (await res.json()) as RegisterResponse;
      expect(body.data.user.email).toBe(email);
      expect(body.data.user.username).toBe(username);
      expect(body.data.user.id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
      );
      expect(body.data.session.id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
      );

      const setCookieHeader = res.headers()['set-cookie'] ?? '';
      expect(setCookieHeader).toContain('chat_sid=');
      expect(setCookieHeader).toContain('HttpOnly');
      expect(setCookieHeader).toContain('csrf_token=');

      // Password is never returned in the response payload.
      expect(JSON.stringify(body)).not.toContain(password);
    } finally {
      await api.dispose();
    }
  });

  test('rejects password that fails complexity rule', async () => {
    const api = await apiRequest.newContext({ baseURL: 'http://localhost:3000' });
    try {
      const suffix = uniqueSuffix();
      const res = await api.post('/auth/register', {
        data: {
          email: `weak-${suffix}@example.com`,
          username: `weak_${suffix}`.replace(/-/g, '_'),
          // 12+ chars but only one class (lowercase) → fails 3-of-4 complexity
          password: 'allloweronly',
        },
      });
      expect(res.status()).toBe(400);
      const body = (await res.json()) as ErrorResponse;
      expect(body.error.code).toBe('VALIDATION_ERROR');
    } finally {
      await api.dispose();
    }
  });

  test('seed fixture accounts are created by /__test/seed', async () => {
    const api = await apiRequest.newContext({ baseURL: 'http://localhost:3000' });
    try {
      const suffix = uniqueSuffix();
      const res = await api.post('/__test/seed', {
        data: {
          strategy: 'truncate',
          users: [
            {
              username: `seeded_${suffix}`.replace(/-/g, '_'),
              email: `seeded-${suffix}@example.com`,
              password: 'StrongPassword123!',
            },
          ],
        },
      });
      expect(res.status()).toBe(200);
      const body = (await res.json()) as SeedResponse;
      expect(Object.keys(body.data.createdIds.users).length).toBe(1);
    } finally {
      await api.dispose();
    }
  });
});

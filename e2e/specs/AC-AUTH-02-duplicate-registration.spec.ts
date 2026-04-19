import { test, expect, request as apiRequest } from '@playwright/test';

type ErrorResponse = {
  error: { code: string; message: string; details?: Record<string, unknown> };
};

function uniqueSuffix(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

test.describe('AC-AUTH-02: registration rejects duplicate email or username', () => {
  test('rejects duplicate email with CONFLICT referencing the email field', async () => {
    const api = await apiRequest.newContext({ baseURL: 'http://localhost:3000' });
    try {
      const suffix = uniqueSuffix();
      const sharedEmail = `dup-email-${suffix}@example.com`;
      const password = 'StrongPassword123!';

      const seedRes = await api.post('/__test/seed', {
        data: {
          strategy: 'truncate',
          users: [
            {
              username: `seed_${suffix}`.replace(/-/g, '_'),
              email: sharedEmail,
              password,
            },
          ],
        },
      });
      expect(seedRes.status()).toBe(200);

      const res = await api.post('/auth/register', {
        data: {
          email: sharedEmail,
          username: `other_${suffix}`.replace(/-/g, '_'),
          password,
        },
      });
      expect(res.status()).toBe(409);
      const body = (await res.json()) as ErrorResponse;
      expect(body.error.code).toBe('CONFLICT');
      expect(body.error.details?.field).toBe('email');
    } finally {
      await api.dispose();
    }
  });

  test('rejects duplicate username with CONFLICT referencing the username field', async () => {
    const api = await apiRequest.newContext({ baseURL: 'http://localhost:3000' });
    try {
      const suffix = uniqueSuffix();
      const sharedUsername = `dup_user_${suffix}`.replace(/-/g, '_');
      const password = 'StrongPassword123!';

      const seedRes = await api.post('/__test/seed', {
        data: {
          strategy: 'truncate',
          users: [
            {
              username: sharedUsername,
              email: `seed-${suffix}@example.com`,
              password,
            },
          ],
        },
      });
      expect(seedRes.status()).toBe(200);

      const res = await api.post('/auth/register', {
        data: {
          email: `other-${suffix}@example.com`,
          username: sharedUsername,
          password,
        },
      });
      expect(res.status()).toBe(409);
      const body = (await res.json()) as ErrorResponse;
      expect(body.error.code).toBe('CONFLICT');
      expect(body.error.details?.field).toBe('username');
    } finally {
      await api.dispose();
    }
  });

  test('rejects duplicate username that differs only in case', async () => {
    const api = await apiRequest.newContext({ baseURL: 'http://localhost:3000' });
    try {
      const suffix = uniqueSuffix();
      const base = `case_${suffix}`.replace(/-/g, '_');
      const password = 'StrongPassword123!';

      const seedRes = await api.post('/__test/seed', {
        data: {
          strategy: 'truncate',
          users: [
            {
              username: base,
              email: `seed-${suffix}@example.com`,
              password,
            },
          ],
        },
      });
      expect(seedRes.status()).toBe(200);

      const res = await api.post('/auth/register', {
        data: {
          email: `other-${suffix}@example.com`,
          username: base.toUpperCase(),
          password,
        },
      });
      expect(res.status()).toBe(409);
      const body = (await res.json()) as ErrorResponse;
      expect(body.error.code).toBe('CONFLICT');
    } finally {
      await api.dispose();
    }
  });
});

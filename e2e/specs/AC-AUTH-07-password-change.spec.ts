import { test, expect, request as apiRequest } from '@playwright/test';
import { csrfHeaders, login } from '../utils/auth.js';

function uniqueSuffix(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

test.describe('AC-AUTH-07: password change', () => {
  test('new password is required for future sign-ins; old password no longer works', async () => {
    const suffix = uniqueSuffix();
    const username = `alice_${suffix}`.replace(/-/g, '_');
    const email = `alice-${suffix}@example.com`;
    const oldPassword = 'OldStrongPassword123!';
    const newPassword = 'NewStrongPassword456!';

    const seedApi = await apiRequest.newContext({ baseURL: 'http://localhost:3000' });
    try {
      await seedApi.post('/__test/seed', {
        data: {
          strategy: 'truncate',
          users: [{ username, email, password: oldPassword }],
        },
      });
    } finally {
      await seedApi.dispose();
    }

    const api = await apiRequest.newContext({ baseURL: 'http://localhost:3000' });
    try {
      const session = await login(api, { email, password: oldPassword });

      const res = await api.post('/auth/password-change', {
        headers: csrfHeaders(session),
        data: { currentPassword: oldPassword, newPassword },
      });
      expect(res.status()).toBe(200);
    } finally {
      await api.dispose();
    }

    // Fresh context (no cookies) — cannot sign in with old password.
    const loginOld = await apiRequest.newContext({ baseURL: 'http://localhost:3000' });
    try {
      const res = await loginOld.post('/auth/login', {
        data: { email, password: oldPassword },
      });
      expect(res.status()).toBe(401);
    } finally {
      await loginOld.dispose();
    }

    // Fresh context — CAN sign in with the new password.
    const loginNew = await apiRequest.newContext({ baseURL: 'http://localhost:3000' });
    try {
      const res = await loginNew.post('/auth/login', {
        data: { email, password: newPassword },
      });
      expect(res.status()).toBe(200);
    } finally {
      await loginNew.dispose();
    }
  });

  test('password-change rejects when current password is wrong', async () => {
    const suffix = uniqueSuffix();
    const username = `bob_${suffix}`.replace(/-/g, '_');
    const email = `bob-${suffix}@example.com`;
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

    const api = await apiRequest.newContext({ baseURL: 'http://localhost:3000' });
    try {
      const session = await login(api, { email, password });

      const res = await api.post('/auth/password-change', {
        headers: csrfHeaders(session),
        data: {
          currentPassword: 'WrongWrongWrong9!',
          newPassword: 'NewStrongPassword456!',
        },
      });
      expect(res.status()).toBe(403);
      const body = (await res.json()) as {
        error: { code: string; details?: { reason?: string } };
      };
      expect(body.error.code).toBe('FORBIDDEN');
      expect(body.error.details?.reason).toBe('currentPasswordInvalid');
    } finally {
      await api.dispose();
    }
  });

  test('password-change requires a valid session', async () => {
    const api = await apiRequest.newContext({ baseURL: 'http://localhost:3000' });
    try {
      // No login, no cookies, no CSRF — preHandler rejects on CSRF first.
      const res = await api.post('/auth/password-change', {
        data: {
          currentPassword: 'OldStrongPassword123!',
          newPassword: 'NewStrongPassword456!',
        },
      });
      expect([401, 403]).toContain(res.status());
    } finally {
      await api.dispose();
    }
  });
});

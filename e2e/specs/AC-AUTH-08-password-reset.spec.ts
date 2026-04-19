import { test, expect, request as apiRequest } from '@playwright/test';

function uniqueSuffix(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

type TokenPeekResponse = { data: { token: string | null } };

test.describe('AC-AUTH-08: token-based password reset restores access', () => {
  test('request -> confirm -> can sign in with new password', async () => {
    const suffix = uniqueSuffix();
    const username = `alice_${suffix}`.replace(/-/g, '_');
    const email = `alice-${suffix}@example.com`;
    const oldPassword = 'OldStrongPassword123!';
    const newPassword = 'NewStrongPassword456!';

    const api = await apiRequest.newContext({ baseURL: 'http://localhost:3000' });
    try {
      await api.post('/__test/seed', {
        data: {
          strategy: 'truncate',
          users: [{ username, email, password: oldPassword }],
        },
      });

      const reqRes = await api.post('/auth/password-reset/request', {
        data: { email },
      });
      expect(reqRes.status()).toBe(200);

      const peek = await api.get(
        `/__test/last-reset-token?email=${encodeURIComponent(email)}`,
      );
      expect(peek.status()).toBe(200);
      const peekBody = (await peek.json()) as TokenPeekResponse;
      const token = peekBody.data.token;
      if (token === null) throw new Error('expected reset token to be issued');

      const confirmRes = await api.post('/auth/password-reset/confirm', {
        data: { token, newPassword },
      });
      expect(confirmRes.status()).toBe(200);

      // Old password no longer works.
      const loginOld = await api.post('/auth/login', {
        data: { email, password: oldPassword },
      });
      expect(loginOld.status()).toBe(401);

      // New password does.
      const loginNew = await api.post('/auth/login', {
        data: { email, password: newPassword },
      });
      expect(loginNew.status()).toBe(200);
    } finally {
      await api.dispose();
    }
  });

  test('reset request for an unknown email still returns 200 (no enumeration)', async () => {
    const suffix = uniqueSuffix();
    const api = await apiRequest.newContext({ baseURL: 'http://localhost:3000' });
    try {
      const res = await api.post('/auth/password-reset/request', {
        data: { email: `ghost-${suffix}@example.com` },
      });
      expect(res.status()).toBe(200);
    } finally {
      await api.dispose();
    }
  });

  test('reset token is single-use — a second confirm fails', async () => {
    const suffix = uniqueSuffix();
    const username = `bob_${suffix}`.replace(/-/g, '_');
    const email = `bob-${suffix}@example.com`;
    const oldPassword = 'OldStrongPassword123!';
    const firstNewPassword = 'NewStrongPassword456!';
    const secondNewPassword = 'AnotherStrongPassword789!';

    const api = await apiRequest.newContext({ baseURL: 'http://localhost:3000' });
    try {
      await api.post('/__test/seed', {
        data: {
          strategy: 'truncate',
          users: [{ username, email, password: oldPassword }],
        },
      });

      await api.post('/auth/password-reset/request', { data: { email } });
      const peek = await api.get(
        `/__test/last-reset-token?email=${encodeURIComponent(email)}`,
      );
      const { data: { token } } = (await peek.json()) as TokenPeekResponse;
      if (token === null) throw new Error('expected reset token to be issued');

      const first = await api.post('/auth/password-reset/confirm', {
        data: { token, newPassword: firstNewPassword },
      });
      expect(first.status()).toBe(200);

      const second = await api.post('/auth/password-reset/confirm', {
        data: { token, newPassword: secondNewPassword },
      });
      expect(second.status()).toBe(400);
    } finally {
      await api.dispose();
    }
  });
});

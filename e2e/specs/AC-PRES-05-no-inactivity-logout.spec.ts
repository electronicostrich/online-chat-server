import { test, expect, request as apiRequest } from '@playwright/test';
import { login } from '../utils/auth.js';

function uniqueSuffix(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

// Practical ceiling on how long a test can idle before flakiness and CI
// budget start mattering. Session TTL is 30 days by default (see
// runtime-and-environment.md §6.1), so any idle window well under that
// proves the "no inactivity logout" rule for this spec's purposes.
const IDLE_MS = 3_000;

test.describe('AC-PRES-05: session stays valid without explicit logout', () => {
  test('GET /sessions still succeeds after an idle window', async () => {
    const suffix = uniqueSuffix();
    const username = `alice_${suffix}`.replace(/-/g, '_');
    const email = `alice-${suffix}@example.com`;
    const password = 'StrongPassword123!';

    const seedApi = await apiRequest.newContext({ baseURL: 'http://localhost:3000' });
    try {
      const seedRes = await seedApi.post('/__test/seed', {
        data: {
          strategy: 'truncate',
          users: [{ username, email, password }],
        },
      });
      expect(seedRes.status()).toBe(200);
    } finally {
      await seedApi.dispose();
    }

    const api = await apiRequest.newContext({ baseURL: 'http://localhost:3000' });
    try {
      const session = await login(api, { email, password });

      await new Promise<void>((resolve) => {
        setTimeout(resolve, IDLE_MS);
      });

      const res = await api.get('/sessions');
      expect(res.status()).toBe(200);
      const body = (await res.json()) as {
        data: { sessions: { id: string; current: boolean }[] };
      };
      const current = body.data.sessions.find((s) => s.current);
      expect(current?.id).toBe(session.sessionId);
    } finally {
      await api.dispose();
    }
  });
});

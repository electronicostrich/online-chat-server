import { test, expect, request as apiRequest } from '@playwright/test';

type HealthzResponse = {
  data: {
    status: string;
    checks: { db: string; redis: string; attachments: string };
    version?: string;
  };
};

test('AC-BOOT-00: full stack boots and healthz reports green', async ({ page }) => {
  const api = await apiRequest.newContext({ baseURL: 'http://localhost:3000' });

  try {
    // 1. API healthz is reachable and healthy
    const res = await api.get('/healthz');
    expect(res.status()).toBe(200);
    const body = (await res.json()) as HealthzResponse;
    expect(body.data.status).toBe('ok');
    expect(body.data.checks.db).toBe('ok');
    expect(body.data.checks.redis).toBe('ok');
    expect(body.data.checks.attachments).toBe('ok');

    // 2. Web shell loads
    await page.goto('/');
    await expect(page).toHaveTitle(/Chat/i);

    // 3. Test-only seed route responds when NODE_ENV=test (set by compose.test.yaml override).
    //    In default dev compose, this route is 404 — that negative case is covered by
    //    apps/api/test/unit/plugins/test-seed.test.ts per docs/testing-strategy.md §4.3.
    const seedRes = await api.post('/__test/seed', {
      data: { strategy: 'truncate', users: [] },
    });
    expect([200, 204]).toContain(seedRes.status());
  } finally {
    await api.dispose();
  }
});

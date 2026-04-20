import { test, expect, request as apiRequest } from '@playwright/test';

type ReadyzResponse = {
  data: {
    status: string;
    checks: {
      db: string;
      redis: string;
      attachments: string;
      migrations: string;
    };
    version?: string;
  };
};

// AC-BOOT-00 (readiness slice): /readyz reports `status: 'ready'` when
// every dependency + the migrations bookkeeping check pass against a
// fully-migrated compose stack. Distinct from /healthz — see
// docs/observability.md §3. The /healthz happy-path is covered by
// AC-BOOT-00-bootstrap.spec.ts.
test('AC-BOOT-00 readyz: compose stack reports status=ready', async () => {
  const api = await apiRequest.newContext({ baseURL: 'http://localhost:3000' });
  try {
    const res = await api.get('/readyz');
    expect(res.status()).toBe(200);
    const body = (await res.json()) as ReadyzResponse;
    expect(body.data.status).toBe('ready');
    expect(body.data.checks.db).toBe('ok');
    expect(body.data.checks.redis).toBe('ok');
    expect(body.data.checks.attachments).toBe('ok');
    expect(body.data.checks.migrations).toBe('ok');
    expect(typeof body.data.version).toBe('string');
  } finally {
    await api.dispose();
  }
});

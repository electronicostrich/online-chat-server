import { describe, test, expect, beforeEach, vi } from 'vitest';
import Fastify from 'fastify';
import type { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import sensible from '@fastify/sensible';
import type * as FsPromisesModule from 'node:fs/promises';

// Mutable holders so each test can rewire the mocked behavior without
// re-hoisting a fresh `vi.mock` call. The factory below reads these
// closures at request time.
const mocks = {
  migrationsRows: [] as { count: number }[],
  redisPing: (): Promise<'PONG'> => Promise.resolve('PONG'),
  fsAccess: (): Promise<void> => Promise.resolve(),
  readdirEntries: ['0001_initial.sql', '0002_auth.sql'],
};

vi.mock('../../../src/db/client.js', () => ({
  pgSql: Object.assign(
    // pgSql`SELECT 1` tag-call: resolves to any non-empty array (the route
    // only cares that it resolves, not the payload shape). pgSql`SELECT count…`
    // needs to return the migrations-row payload. We distinguish on the SQL
    // template's first string fragment.
    (strings: TemplateStringsArray) => {
      const sql = strings.join(' ');
      if (/count\(\*\)/.test(sql)) {
        return Promise.resolve(mocks.migrationsRows);
      }
      return Promise.resolve([{ ok: 1 }]);
    },
    {
      unsafe: () => ({ simple: () => Promise.resolve(undefined) }),
    },
  ),
}));

vi.mock('../../../src/redis/client.js', () => ({
  redis: {
    ping: (): Promise<'PONG'> => mocks.redisPing(),
  },
}));

vi.mock('node:fs/promises', async () => {
  const actual =
    await vi.importActual<typeof FsPromisesModule>('node:fs/promises');
  return {
    ...actual,
    access: (): Promise<void> => mocks.fsAccess(),
    readdir: (): Promise<string[]> => Promise.resolve(mocks.readdirEntries),
  };
});

vi.mock('../../../src/config/env.js', () => ({
  config: {
    ATTACHMENT_ROOT_DIR: '/tmp/attachments-readyz-test',
    DATABASE_URL: 'postgres://stub',
  },
}));

async function buildApp() {
  const { readyzRoute, __resetMigrationCountCacheForTests } = await import(
    '../../../src/routes/readyz.js'
  );
  __resetMigrationCountCacheForTests();
  const app = Fastify().withTypeProvider<TypeBoxTypeProvider>();
  await app.register(sensible);
  await app.register(readyzRoute);
  return app;
}

describe('GET /readyz', () => {
  beforeEach(() => {
    mocks.migrationsRows = [{ count: 2 }];
    mocks.redisPing = () => Promise.resolve('PONG');
    mocks.fsAccess = () => Promise.resolve();
    mocks.readdirEntries = ['0001_initial.sql', '0002_auth.sql'];
  });

  test('returns 200 with status=ready when every dependency is healthy', async () => {
    const app = await buildApp();
    try {
      const res = await app.inject({ method: 'GET', url: '/readyz' });
      expect(res.statusCode).toBe(200);
      const body: {
        data: {
          status: string;
          checks: {
            db: string;
            redis: string;
            attachments: string;
            migrations: string;
          };
        };
      } = res.json();
      expect(body.data.status).toBe('ready');
      expect(body.data.checks).toEqual({
        db: 'ok',
        redis: 'ok',
        attachments: 'ok',
        migrations: 'ok',
      });
    } finally {
      await app.close();
    }
  });

  test('returns 503 with migrations=down when _migrations count is below the expected file count', async () => {
    mocks.migrationsRows = [{ count: 1 }];
    mocks.readdirEntries = ['0001_initial.sql', '0002_auth.sql'];
    const app = await buildApp();
    try {
      const res = await app.inject({ method: 'GET', url: '/readyz' });
      expect(res.statusCode).toBe(503);
      const body: {
        error: {
          code: string;
          details?: {
            failing?: string[];
            checks?: { migrations?: string };
          };
        };
      } = res.json();
      expect(body.error.code).toBe('SERVICE_UNAVAILABLE');
      expect(body.error.details?.checks?.migrations).toBe('down');
      expect(body.error.details?.failing).toContain('migrations');
    } finally {
      await app.close();
    }
  });

  test('returns 503 when redis is unreachable but reports other checks faithfully', async () => {
    mocks.redisPing = () => Promise.reject(new Error('ECONNREFUSED'));
    const app = await buildApp();
    try {
      const res = await app.inject({ method: 'GET', url: '/readyz' });
      expect(res.statusCode).toBe(503);
      const body: {
        error: {
          details?: { failing?: string[]; checks?: Record<string, string> };
        };
      } = res.json();
      expect(body.error.details?.failing).toEqual(['redis']);
      expect(body.error.details?.checks?.db).toBe('ok');
      expect(body.error.details?.checks?.migrations).toBe('ok');
    } finally {
      await app.close();
    }
  });
});

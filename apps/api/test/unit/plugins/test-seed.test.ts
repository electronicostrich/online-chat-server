import { describe, test, expect, afterEach, vi } from 'vitest';
import Fastify from 'fastify';
import type { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import sensible from '@fastify/sensible';

// Mock the DB layer so the /__test/seed handler's TRUNCATE + INSERT paths
// don't require a running Postgres. We only assert the NODE_ENV guard here;
// integration coverage for the seed's DB effects lives in e2e specs (see
// docs/testing-strategy.md §5.2).
vi.mock('../../../src/db/client.js', () => ({
  pgSql: Object.assign(
    () => Promise.resolve([]),
    {
      unsafe: () => ({ simple: () => Promise.resolve(undefined) }),
    },
  ),
}));
vi.mock('../../../src/modules/auth/repository.js', () => ({
  insertUser: vi.fn(() => Promise.resolve({ id: 'mock-user-id' })),
  findUserByEmailCanonical: vi.fn(() => Promise.resolve(undefined)),
  findUserByUsernameCanonical: vi.fn(() => Promise.resolve(undefined)),
  insertSession: vi.fn(),
  findActiveSessionByTokenHash: vi.fn(),
  revokeSessionById: vi.fn(),
  listActiveSessionsForUser: vi.fn(),
  touchSessionLastSeen: vi.fn(),
}));
vi.mock('../../../src/modules/auth/password.js', () => ({
  hashPassword: vi.fn(() => Promise.resolve('$argon2id$fake')),
  verifyPassword: vi.fn(() => Promise.resolve(true)),
  passwordMeetsComplexity: vi.fn(() => true),
}));

const originalNodeEnv = process.env.NODE_ENV;

afterEach(() => {
  // process.env coerces assignment to string — assigning `undefined` would
  // literally set NODE_ENV to the string 'undefined'. Delete instead when the
  // original value was unset, so tests don't leak a fake NODE_ENV=undefined.
  if (originalNodeEnv === undefined) {
    delete process.env.NODE_ENV;
  } else {
    process.env.NODE_ENV = originalNodeEnv;
  }
});

describe('/__test/seed NODE_ENV guard (docs/testing-strategy.md §4.3)', () => {
  test('registers the route when NODE_ENV=test', async () => {
    process.env.NODE_ENV = 'test';
    const { testSeedRoute } = await import('../../../src/routes/test-seed.js');
    const app = Fastify().withTypeProvider<TypeBoxTypeProvider>();
    await app.register(sensible);
    await app.register(testSeedRoute);

    const res = await app.inject({
      method: 'POST',
      url: '/__test/seed',
      payload: { strategy: 'truncate', users: [] },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toEqual({
      data: {
        createdIds: { users: {}, rooms: {}, messages: [] },
      },
    });

    await app.close();
  });

  test('does NOT register the route when NODE_ENV=production', async () => {
    process.env.NODE_ENV = 'production';
    const { testSeedRoute } = await import('../../../src/routes/test-seed.js');
    const app = Fastify().withTypeProvider<TypeBoxTypeProvider>();
    await app.register(sensible);
    await app.register(testSeedRoute);

    const res = await app.inject({
      method: 'POST',
      url: '/__test/seed',
      payload: { strategy: 'truncate', users: [] },
    });

    expect(res.statusCode).toBe(404);
    await app.close();
  });

  test('does NOT register the route when NODE_ENV=development', async () => {
    process.env.NODE_ENV = 'development';
    const { testSeedRoute } = await import('../../../src/routes/test-seed.js');
    const app = Fastify().withTypeProvider<TypeBoxTypeProvider>();
    await app.register(sensible);
    await app.register(testSeedRoute);

    const res = await app.inject({
      method: 'POST',
      url: '/__test/seed',
      payload: { strategy: 'truncate', users: [] },
    });

    expect(res.statusCode).toBe(404);
    await app.close();
  });

  // Guards the WS-08 follow-through on the `upsert` strategy. Before this
  // work the handler threw 501 with a "not yet implemented (WS-08)"
  // message, so pinning a 200 for the same payload blocks accidental
  // re-introduction of that deferral.
  test('strategy=upsert reaches the handler (no 501 regression)', async () => {
    process.env.NODE_ENV = 'test';
    const { testSeedRoute } = await import('../../../src/routes/test-seed.js');
    const app = Fastify().withTypeProvider<TypeBoxTypeProvider>();
    await app.register(sensible);
    await app.register(testSeedRoute);

    const res = await app.inject({
      method: 'POST',
      url: '/__test/seed',
      payload: { strategy: 'upsert', users: [] },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toEqual({
      data: {
        createdIds: { users: {}, rooms: {}, messages: [] },
      },
    });

    await app.close();
  });

  // Under 'upsert', a user the seed already declared must not re-hash the
  // password — Argon2id is slow and repeated runs would become quadratic.
  // The mocked DB returns an existing row from findUserByEmailCanonical…
  // but the route uses a raw pgSql SELECT, so we verify behaviour by
  // stubbing pgSql to return a row for the second call while leaving
  // insertUser mocked to fail if it's reached.
  test('strategy=upsert skips hashPassword for an already-present user', async () => {
    process.env.NODE_ENV = 'test';
    vi.resetModules();

    // Mock-ordering contract for this test, please do not reorder:
    //   1. Import and arm `hashPassword` + `insertUser` first so their
    //      module-level mocks are the ones the route sees.
    //   2. Replace `pgSql` via `vi.doMock` next — doMock is deferred and
    //      only takes effect on later `import`s, so it must land BEFORE
    //      the testSeedRoute import below.
    //   3. Dynamically import `testSeedRoute` last so the route's
    //      `import '../../../src/db/client.js'` resolves to the doMock'd
    //      version.
    const { hashPassword } = await import('../../../src/modules/auth/password.js');
    const { insertUser } = await import('../../../src/modules/auth/repository.js');
    vi.mocked(hashPassword).mockResolvedValue('$argon2id$fake');
    vi.mocked(insertUser).mockImplementation(() => {
      throw new Error('insertUser must not be called on upsert-hit');
    });
    vi.doMock('../../../src/db/client.js', () => ({
      pgSql: Object.assign(
        () =>
          Promise.resolve([{ id: '11111111-1111-1111-1111-111111111111' }]),
        {
          unsafe: () => ({ simple: () => Promise.resolve(undefined) }),
        },
      ),
    }));

    const { testSeedRoute } = await import('../../../src/routes/test-seed.js');
    const app = Fastify().withTypeProvider<TypeBoxTypeProvider>();
    await app.register(sensible);
    await app.register(testSeedRoute);

    const res = await app.inject({
      method: 'POST',
      url: '/__test/seed',
      payload: {
        strategy: 'upsert',
        users: [
          { username: 'alice', email: 'alice@chat.local', password: 'Password123!' },
        ],
      },
    });

    expect(res.statusCode).toBe(200);
    expect(vi.mocked(hashPassword)).not.toHaveBeenCalled();
    expect(vi.mocked(insertUser)).not.toHaveBeenCalled();
    const body: {
      data: { createdIds: { users: Record<string, string> } };
    } = res.json();
    expect(body.data.createdIds.users.alice).toBe(
      '11111111-1111-1111-1111-111111111111',
    );

    await app.close();
  });
});

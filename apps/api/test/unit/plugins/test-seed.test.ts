import { describe, test, expect, afterEach } from 'vitest';
import Fastify from 'fastify';
import type { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import sensible from '@fastify/sensible';

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
});

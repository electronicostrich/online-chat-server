import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { access, constants, readdir } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  ReadyzResponseSchema,
  ErrorEnvelopeSchema,
  ErrorCodes,
} from 'shared-schemas';
import { pgSql } from '../db/client.js';
import { redis } from '../redis/client.js';
import { config } from '../config/env.js';

type CheckStatus = 'ok' | 'down';

const packageJsonPath = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'package.json',
);
const pkg = JSON.parse(readFileSync(packageJsonPath, 'utf-8')) as {
  version: string;
};

const migrationsDir = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'drizzle',
);

// Resolve the expected migration count once at module load. Why cache: /readyz
// is hit by orchestrators at poll-rate (every few seconds) and re-listing the
// directory on every probe would be wasteful. The migration directory is
// immutable for the lifetime of a running API container.
let expectedMigrationCountPromise: Promise<number> | undefined;
function expectedMigrationCount(): Promise<number> {
  if (expectedMigrationCountPromise === undefined) {
    expectedMigrationCountPromise = readdir(migrationsDir).then((entries) =>
      entries.filter((f) => f.endsWith('.sql')).length,
    );
  }
  return expectedMigrationCountPromise;
}

export function __resetMigrationCountCacheForTests(): void {
  expectedMigrationCountPromise = undefined;
}

async function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeoutPromise = new Promise<T>((_resolve, reject) => {
    timer = setTimeout(() => {
      reject(new Error('timeout'));
    }, ms);
  });
  try {
    return await Promise.race([p, timeoutPromise]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

export async function checkMigrationsApplied(): Promise<CheckStatus> {
  const expected = await expectedMigrationCount();
  const rows = await pgSql<{ count: number }[]>`
    SELECT count(*)::int AS count FROM _migrations
  `;
  const applied = rows[0]?.count ?? 0;
  return applied >= expected && expected > 0 ? 'ok' : 'down';
}

export const readyzRoute: FastifyPluginAsyncTypebox = (fastify) => {
  fastify.get(
    '/readyz',
    {
      schema: {
        response: {
          200: ReadyzResponseSchema,
          503: ErrorEnvelopeSchema,
        },
      },
    },
    async (_req, reply) => {
      const checks: {
        db: CheckStatus;
        redis: CheckStatus;
        attachments: CheckStatus;
        migrations: CheckStatus;
      } = { db: 'down', redis: 'down', attachments: 'down', migrations: 'down' };

      const [dbResult, redisResult, fsResult, migrationsResult] =
        await Promise.allSettled([
          withTimeout(pgSql`SELECT 1`, 250),
          withTimeout(redis.ping(), 250),
          withTimeout(access(config.ATTACHMENT_ROOT_DIR, constants.W_OK), 250),
          withTimeout(checkMigrationsApplied(), 500),
        ]);

      checks.db = dbResult.status === 'fulfilled' ? 'ok' : 'down';
      checks.redis = redisResult.status === 'fulfilled' ? 'ok' : 'down';
      checks.attachments = fsResult.status === 'fulfilled' ? 'ok' : 'down';
      checks.migrations =
        migrationsResult.status === 'fulfilled' ? migrationsResult.value : 'down';

      const failing = (
        Object.entries(checks) as [keyof typeof checks, CheckStatus][]
      )
        .filter(([, v]) => v !== 'ok')
        .map(([k]) => k);

      if (failing.length > 0) {
        return reply.status(503).send({
          error: {
            code: ErrorCodes.SERVICE_UNAVAILABLE,
            message: 'One or more readiness checks failed.',
            details: { failing, checks },
            traceId: reply.request.id,
          },
        });
      }

      return reply.status(200).send({
        data: {
          status: 'ready',
          checks,
          version: pkg.version,
        },
      });
    },
  );
  return Promise.resolve();
};

import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { access, constants } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  HealthzResponseSchema,
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

async function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return await Promise.race([
    p,
    new Promise<T>((_resolve, reject) => {
      setTimeout(() => {
        reject(new Error('timeout'));
      }, ms);
    }),
  ]);
}

export const healthzRoute: FastifyPluginAsyncTypebox = async (fastify) => {
  fastify.get(
    '/healthz',
    {
      schema: {
        response: {
          200: HealthzResponseSchema,
          503: ErrorEnvelopeSchema,
        },
      },
    },
    async (_req, reply) => {
      const checks: {
        db: CheckStatus;
        redis: CheckStatus;
        attachments: CheckStatus;
      } = { db: 'down', redis: 'down', attachments: 'down' };

      const [dbResult, redisResult, fsResult] = await Promise.allSettled([
        withTimeout(pgSql`SELECT 1`, 250),
        withTimeout(redis.ping(), 250),
        withTimeout(access(config.ATTACHMENT_ROOT_DIR, constants.W_OK), 250),
      ]);

      checks.db = dbResult.status === 'fulfilled' ? 'ok' : 'down';
      checks.redis = redisResult.status === 'fulfilled' ? 'ok' : 'down';
      checks.attachments = fsResult.status === 'fulfilled' ? 'ok' : 'down';

      const failing = (Object.entries(checks) as [keyof typeof checks, CheckStatus][])
        .filter(([, v]) => v !== 'ok')
        .map(([k]) => k);

      if (failing.length > 0) {
        return reply.status(503).send({
          error: {
            code: ErrorCodes.SERVICE_UNAVAILABLE,
            message: 'One or more dependencies are unhealthy.',
            details: { failing, checks },
            traceId: reply.request.id,
          },
        });
      }

      return reply.status(200).send({
        data: {
          status: 'ok',
          checks,
          version: pkg.version,
        },
      });
    },
  );
};

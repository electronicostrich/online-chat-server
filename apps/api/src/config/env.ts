import { Type, type Static } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';

const EnvSchema = Type.Object({
  NODE_ENV: Type.Union([
    Type.Literal('development'),
    Type.Literal('test'),
    Type.Literal('production'),
  ]),
  PORT: Type.Integer({ minimum: 1, maximum: 65535 }),
  DATABASE_URL: Type.String({ minLength: 1 }),
  REDIS_URL: Type.String({ minLength: 1 }),
  LOG_LEVEL: Type.String({ minLength: 1 }),
  ATTACHMENT_ROOT_DIR: Type.String({ minLength: 1 }),
  ALLOWED_ORIGINS: Type.Array(Type.String()),
});
type EnvShape = Static<typeof EnvSchema>;

function loadConfig(): EnvShape {
  const raw = {
    NODE_ENV: process.env.NODE_ENV ?? 'development',
    PORT: Number(process.env.PORT ?? '3000'),
    DATABASE_URL: process.env.DATABASE_URL ?? '',
    REDIS_URL: process.env.REDIS_URL ?? '',
    LOG_LEVEL: process.env.LOG_LEVEL ?? 'info',
    ATTACHMENT_ROOT_DIR: process.env.ATTACHMENT_ROOT_DIR ?? '/data/attachments',
    ALLOWED_ORIGINS: (process.env.ALLOWED_ORIGINS ?? 'http://localhost:5173')
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0),
  };
  if (!Value.Check(EnvSchema, raw)) {
    const errors = [...Value.Errors(EnvSchema, raw)].map(
      (e) => `${e.path}: ${e.message}`,
    );
    throw new Error(`Invalid environment configuration:\n  ${errors.join('\n  ')}`);
  }
  return raw;
}

export const config = loadConfig();
export type Config = EnvShape;

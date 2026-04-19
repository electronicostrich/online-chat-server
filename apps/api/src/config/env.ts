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
  SESSION_SECRET: Type.String({ minLength: 32 }),
  CSRF_SECRET: Type.String({ minLength: 32 }),
  SESSION_COOKIE_NAME: Type.String({ minLength: 1 }),
  SESSION_COOKIE_SECURE: Type.Boolean(),
  SESSION_COOKIE_SAMESITE: Type.Union([
    Type.Literal('strict'),
    Type.Literal('lax'),
    Type.Literal('none'),
  ]),
  SESSION_TTL_SECONDS: Type.Integer({ minimum: 60 }),
  PASSWORD_ARGON2_MEMORY_KIB: Type.Integer({ minimum: 1024 }),
  PASSWORD_ARGON2_ITERATIONS: Type.Integer({ minimum: 1 }),
  PASSWORD_ARGON2_PARALLELISM: Type.Integer({ minimum: 1 }),
});
type EnvShape = Static<typeof EnvSchema>;

function parseBool(raw: string | undefined, fallback: boolean): boolean {
  if (raw === undefined || raw.length === 0) return fallback;
  const normalized = raw.toLowerCase();
  if (normalized === 'true' || normalized === '1' || normalized === 'yes') return true;
  if (normalized === 'false' || normalized === '0' || normalized === 'no') return false;
  throw new Error(`Invalid boolean env value: ${raw}`);
}

function loadConfig(): EnvShape {
  const nodeEnv = process.env.NODE_ENV ?? 'development';
  const raw = {
    NODE_ENV: nodeEnv,
    PORT: Number(process.env.PORT ?? '3000'),
    DATABASE_URL: process.env.DATABASE_URL ?? '',
    REDIS_URL: process.env.REDIS_URL ?? '',
    LOG_LEVEL: process.env.LOG_LEVEL ?? 'info',
    ATTACHMENT_ROOT_DIR: process.env.ATTACHMENT_ROOT_DIR ?? '/data/attachments',
    ALLOWED_ORIGINS: (process.env.ALLOWED_ORIGINS ?? 'http://localhost:5173')
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0),
    SESSION_SECRET: process.env.SESSION_SECRET ?? '',
    CSRF_SECRET: process.env.CSRF_SECRET ?? '',
    SESSION_COOKIE_NAME: process.env.SESSION_COOKIE_NAME ?? 'chat_sid',
    SESSION_COOKIE_SECURE: parseBool(
      process.env.SESSION_COOKIE_SECURE,
      nodeEnv === 'production',
    ),
    SESSION_COOKIE_SAMESITE: process.env.SESSION_COOKIE_SAMESITE ?? 'lax',
    SESSION_TTL_SECONDS: Number(process.env.SESSION_TTL_SECONDS ?? '2592000'),
    PASSWORD_ARGON2_MEMORY_KIB: Number(process.env.PASSWORD_ARGON2_MEMORY_KIB ?? '19456'),
    PASSWORD_ARGON2_ITERATIONS: Number(process.env.PASSWORD_ARGON2_ITERATIONS ?? '2'),
    PASSWORD_ARGON2_PARALLELISM: Number(process.env.PASSWORD_ARGON2_PARALLELISM ?? '1'),
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

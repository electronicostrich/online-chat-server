import { describe, test, expect, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// The seed module imports `logger` → `config/env.ts`, which validates
// process.env at import-time and throws on the minimal vitest env.
// Populate just the fields the validator checks. These are fixtures,
// not real secrets — they satisfy the typebox length minimums and never
// touch a real service.
process.env.NODE_ENV ??= 'development';
process.env.DATABASE_URL ??= 'postgres://unit-test@localhost/seed-test';
process.env.REDIS_URL ??= 'redis://localhost:6379/0';
process.env.SESSION_SECRET ??= 'a'.repeat(32);
process.env.CSRF_SECRET ??= 'b'.repeat(32);
process.env.ALLOWED_ORIGINS ??= 'http://localhost:5173';

// @node-rs/argon2 tries to load a native binding when password.ts is
// imported transitively. Seed source-scan + production-refusal tests
// never hash anything, so stub the module to keep vitest hermetic.
vi.mock('../../../src/modules/auth/password.js', () => ({
  hashPassword: vi.fn(() => Promise.resolve('$argon2id$fake')),
  verifyPassword: vi.fn(() => Promise.resolve(true)),
  passwordMeetsComplexity: vi.fn(() => true),
}));

// Seed-module unit coverage. This file asserts the two invariants that
// keep the dev seed safe to re-run:
//
// 1. Source-level invariant: runSeed must not emit destructive SQL
//    (TRUNCATE / DROP / DELETE). This is a cheap byte-scan of the
//    shipping source — an integration test against a live DB would
//    prove the same thing but would require containers at unit-test
//    time. The `docs/ai-development-guardrails.md` §5.1 "destructive
//    SQL outside apps/api/test/ paths" rule already blocks those
//    tokens in CI; this scan is the per-module backup so a future edit
//    can't quietly add a TRUNCATE inside a string-concat'd query.
//
// 2. Runtime invariant: runSeed refuses to run under
//    NODE_ENV=production. Verified by calling the exported function
//    with a null-ish `sql` client — the env check short-circuits
//    before any DB call.

const hereDir = dirname(fileURLToPath(import.meta.url));
const seedPath = join(hereDir, '..', '..', '..', 'src', 'db', 'seed.ts');

// The module-top ??= block above guarantees NODE_ENV is defined as a
// string by the time this line executes, so the restore path has a
// concrete value to assign.
const originalNodeEnv = process.env.NODE_ENV;

afterEach(() => {
  process.env.NODE_ENV = originalNodeEnv;
});

describe('db/seed.ts invariants', () => {
  test('source never emits destructive SQL tokens', () => {
    const src = readFileSync(seedPath, 'utf-8');
    // Strip block and line comments so the scan cannot flag harmless
    // prose ("no TRUNCATE / DROP") from being interpreted as SQL.
    const stripped = src
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
    for (const banned of ['TRUNCATE', 'DROP TABLE', 'DROP COLUMN', 'DELETE FROM']) {
      expect(stripped, `seed.ts must not contain ${banned}`).not.toMatch(
        new RegExp(`\\b${banned}\\b`, 'i'),
      );
    }
  });

  test('runSeed refuses to run under NODE_ENV=production', async () => {
    process.env.NODE_ENV = 'production';
    const { runSeed, DEV_FIXTURE } = await import('../../../src/db/seed.js');
    // The env check short-circuits before any DB call, so this stub is
    // never invoked — but runSeed's signature requires a non-null Sql
    // client and we want the failure to come from the env guard, not a
    // TypeError on a missing argument. A throw-on-call stub makes any
    // accidental DB access under production very loud.
    const sqlStub: Parameters<typeof runSeed>[0] = new Proxy({}, {
      get() {
        throw new Error('sql client must not be used under NODE_ENV=production');
      },
    }) as Parameters<typeof runSeed>[0];
    await expect(() => runSeed(sqlStub, DEV_FIXTURE)).rejects.toThrow(
      /db:seed is dev-only/,
    );
  });

  test('DEV_FIXTURE has enough shape to exercise room/DM/block flows', async () => {
    const { DEV_FIXTURE } = await import('../../../src/db/seed.js');
    const { normalizeEmail } = await import(
      '../../../src/modules/auth/normalize.js'
    );
    // Four users with exactly four unique email_canonical forms — this is
    // the assertion that protects against a future fixture edit that
    // duplicates an email and would make the seed non-deterministic
    // across machines. Use the same normalization the `users.email_canonical`
    // column uses (NFC + trim + lowercase) so visually-identical Unicode
    // sequences or whitespace variations can't slip past the test.
    const emails = new Set(DEV_FIXTURE.users.map((u) => normalizeEmail(u.email)));
    expect(emails.size).toBe(DEV_FIXTURE.users.length);
    expect(DEV_FIXTURE.users.length).toBeGreaterThanOrEqual(4);
    expect(DEV_FIXTURE.rooms.some((r) => r.visibility === 'public')).toBe(true);
    expect(DEV_FIXTURE.rooms.some((r) => r.visibility === 'private')).toBe(true);
    expect(DEV_FIXTURE.friendships.length).toBeGreaterThanOrEqual(1);
    expect(DEV_FIXTURE.blocks.length).toBeGreaterThanOrEqual(1);
  });
});

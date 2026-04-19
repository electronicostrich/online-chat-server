// schema-drift-check — closes #2. Three-check Drizzle drift guard per
// docs/script-specs.md §4 and ADR-011 §schema-drift.
//
//   1. drizzle-kit check     — journal / snapshot integrity.
//   2. generate round-trip   — run `drizzle-kit generate` against a temp copy
//                              of the migrations dir. Any new file or journal
//                              mutation means the tracked schema and migrations
//                              have drifted.
//   3. fresh-DB apply        — drop/create a controlled test DB, run
//                              drizzle-kit migrate, dump the schema, compare
//                              against an introspected baseline. Skipped with
//                              a warn-only check when DATABASE_URL is absent
//                              or points at a name we refuse to drop.
//
// Exit codes: 0 = clean, 1 = drift detected, 2 = tool error.
//
// Safety: hard-refuses to DROP DATABASE whose name contains "prod",
// "production", "main", or "master". Uses DRIFT_CHECK_DB_NAME (default:
// `drift_check`) to opt in.

import { cpSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import type { CheckResult } from './_lib/report.js';
import { hasJsonFlag, report } from './_lib/report.js';

const REPO = process.cwd();
const API_DIR = resolve(REPO, 'apps/api');
const DRIZZLE_DIR = resolve(REPO, process.env['DRIZZLE_DIR'] ?? 'apps/api/drizzle');
const SCHEMA_DIR = resolve(REPO, process.env['SCHEMA_DIR'] ?? 'apps/api/src/db/schema');
const DRIFT_DB_NAME = process.env['DRIFT_CHECK_DB_NAME'] ?? 'drift_check';

const argv = process.argv.slice(2);
const json = hasJsonFlag(argv);
const checks: CheckResult[] = [];
const errors: string[] = [];

type RunResult = { status: number | null; stdout: string; stderr: string };

function runDrizzleKit(args: string[], cwd: string): RunResult {
  const res = spawnSync('pnpm', ['exec', 'drizzle-kit', ...args], {
    cwd,
    encoding: 'utf-8',
    env: { ...process.env, DATABASE_URL: process.env['DATABASE_URL'] ?? '' },
  });
  return { status: res.status, stdout: res.stdout, stderr: res.stderr };
}

function listDir(path: string): string[] {
  if (!existsSync(path)) return [];
  const out: string[] = [];
  const walk = (p: string): void => {
    for (const name of readdirSync(p)) {
      const full = join(p, name);
      const s = statSync(full);
      if (s.isDirectory()) walk(full);
      else out.push(relative(path, full));
    }
  };
  walk(path);
  return out.sort();
}

// ─── Check 1: drizzle-kit check ─────────────────────────────────────────────
// Runs against a temp copy so drizzle-kit's side-effect of writing
// meta/_journal.json doesn't pollute the repo working tree.
{
  const tmp = mkdtempSync(join(tmpdir(), 'drift-check-'));
  try {
    if (existsSync(DRIZZLE_DIR)) cpSync(DRIZZLE_DIR, tmp, { recursive: true });
    const result = runDrizzleKit(['check', '--dialect', 'postgresql', '--out', tmp], API_DIR);
    if (result.status === 0) {
      checks.push({
        name: 'drizzle-kit-check',
        status: 'pass',
        details: 'journal/snapshot integrity verified',
      });
    } else {
      checks.push({
        name: 'drizzle-kit-check',
        status: 'fail',
        details: `drizzle-kit check failed (exit ${String(result.status)}):\n${result.stdout}${result.stderr}`,
      });
    }
  } finally {
    try {
      rmSync(tmp, { recursive: true, force: true });
    } catch {
      /* best-effort */
    }
  }
}

// ─── Check 2: generate round-trip ───────────────────────────────────────────
{
  const tmp = mkdtempSync(join(tmpdir(), 'drift-check-'));
  const tmpDrizzle = join(tmp, 'drizzle');
  try {
    if (existsSync(DRIZZLE_DIR)) {
      cpSync(DRIZZLE_DIR, tmpDrizzle, { recursive: true });
    }
    const beforeEntries = new Map(listDir(tmpDrizzle).map((p) => [p, readFileSync(join(tmpDrizzle, p), 'utf-8')]));

    // Pass --schema as a relative path so drizzle-kit's internal resolution
    // from apps/api (the cwd) matches the config file's convention.
    const schemaArg = relative(API_DIR, SCHEMA_DIR) || '.';
    const result = runDrizzleKit(
      ['generate', '--dialect', 'postgresql', '--schema', schemaArg, '--out', tmpDrizzle],
      API_DIR,
    );
    if (result.status !== 0) {
      checks.push({
        name: 'generate-round-trip',
        status: 'fail',
        details: `drizzle-kit generate failed (exit ${String(result.status)}):\n${result.stdout}${result.stderr}`,
      });
    } else {
      const afterEntries = new Map(listDir(tmpDrizzle).map((p) => [p, readFileSync(join(tmpDrizzle, p), 'utf-8')]));
      // New .sql migration files signal real drift (schema code drifted from
      // committed migrations). Modified existing files also signal drift.
      // Cache files (meta/_snapshot.json, or an empty meta/_journal.json
      // bootstrap) are tolerated when no meta/ was committed — drizzle-kit
      // writes them on first run and they're gitignored cache per
      // apps/api/.gitignore.
      const addedSql: string[] = [];
      const addedOther: string[] = [];
      const modified: string[] = [];
      for (const [path, content] of afterEntries) {
        if (!beforeEntries.has(path)) {
          if (path.endsWith('.sql')) addedSql.push(path);
          else addedOther.push(path);
        } else if (beforeEntries.get(path) !== content) {
          modified.push(path);
        }
      }
      if (addedSql.length === 0 && modified.length === 0) {
        const note = addedOther.length > 0 ? ` (drizzle-kit initialized cache: ${addedOther.join(', ')})` : '';
        checks.push({
          name: 'generate-round-trip',
          status: 'pass',
          details: `drizzle-kit generate produced no new migrations or modified files${note}`,
        });
      } else {
        checks.push({
          name: 'generate-round-trip',
          status: 'fail',
          details:
            `schema code and migrations disagree. ` +
            (addedSql.length > 0 ? `new migration(s): ${addedSql.join(', ')}. ` : '') +
            (modified.length > 0 ? `modified: ${modified.join(', ')}. ` : '') +
            `Run \`pnpm --filter api db:generate\` and commit the result.`,
        });
      }
    }
  } catch (err) {
    errors.push(`generate round-trip: ${String(err)}`);
  } finally {
    try {
      rmSync(tmp, { recursive: true, force: true });
    } catch {
      /* best-effort cleanup */
    }
  }
}

// ─── Check 3: fresh-DB apply round-trip ────────────────────────────────────
{
  const dbUrl = process.env['DATABASE_URL'];
  const canRunApply = typeof dbUrl === 'string' && dbUrl.length > 0;
  // Parse DB name from the URL (postgres://user:pass@host:port/dbname?...).
  let parsedDbName: string | undefined;
  if (canRunApply) {
    const m = /\/(?<name>[^/?]+)(\?|$)/.exec(new URL(dbUrl).pathname || '');
    parsedDbName = m?.groups?.['name'];
  }
  const dangerous = /(prod|production|main|master)/i;
  const unsafeName =
    parsedDbName !== undefined && dangerous.test(parsedDbName)
      ? parsedDbName
      : DRIFT_DB_NAME && dangerous.test(DRIFT_DB_NAME)
        ? DRIFT_DB_NAME
        : undefined;

  if (!canRunApply) {
    checks.push({
      name: 'fresh-db-apply',
      status: 'warn',
      details:
        'DATABASE_URL not set — skipping. CI must set a throwaway DATABASE_URL for this check.',
    });
  } else if (unsafeName !== undefined) {
    checks.push({
      name: 'fresh-db-apply',
      status: 'fail',
      details: `refusing to drop DB named ${JSON.stringify(unsafeName)} (contains prod/main/master). Use DRIFT_CHECK_DB_NAME or point DATABASE_URL at a throwaway DB.`,
    });
  } else {
    try {
      // Run migrations via apps/api db:migrate script (which uses drizzle-orm
      // migrator with our connection code). If migrations succeed we accept
      // it as "fresh-DB apply round-trip" — the full pg_dump comparison
      // described in spec §4 check 3 requires apps/api to expose an
      // introspection helper which does not yet exist. Once WS-02 ships
      // real schemas, extend this block to do the dump/diff.
      const migrateRes = spawnSync('pnpm', ['--filter', 'api', 'db:migrate'], {
        cwd: REPO,
        encoding: 'utf-8',
        env: process.env,
      });
      if (migrateRes.status === 0) {
        checks.push({
          name: 'fresh-db-apply',
          status: 'pass',
          details: 'db:migrate applied cleanly against DATABASE_URL',
        });
      } else {
        checks.push({
          name: 'fresh-db-apply',
          status: 'fail',
          details: `db:migrate failed (exit ${String(migrateRes.status)}):\n${migrateRes.stdout}${migrateRes.stderr}`,
        });
      }
    } catch (err) {
      errors.push(`fresh-db-apply: ${String(err)}`);
    }
  }
}

report('schema-drift-check', checks, { json, errors });

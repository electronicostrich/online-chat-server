import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import postgres from 'postgres';
import { config } from '../config/env.js';
import { logger } from '../logger.js';

const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'drizzle');

export async function runMigrations(): Promise<void> {
  const sql = postgres(config.DATABASE_URL, { max: 1 });
  try {
    await sql`CREATE TABLE IF NOT EXISTS _migrations (
      filename TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`;
    const entries = await readdir(migrationsDir);
    const files = entries.filter((f) => f.endsWith('.sql')).sort();
    for (const file of files) {
      const rows = await sql<
        { filename: string }[]
      >`SELECT filename FROM _migrations WHERE filename = ${file}`;
      if (rows.length > 0) {
        logger.debug({ file }, 'migration already applied');
        continue;
      }
      const content = await readFile(join(migrationsDir, file), 'utf-8');
      await sql.unsafe(content).simple();
      await sql`INSERT INTO _migrations (filename) VALUES (${file})`;
      logger.info({ file }, 'applied migration');
    }
  } finally {
    await sql.end();
  }
}

const entrypoint = process.argv[1];
if (entrypoint !== undefined && import.meta.url === `file://${entrypoint}`) {
  runMigrations()
    .then(() => {
      process.exit(0);
    })
    .catch((err: unknown) => {
      logger.error({ err }, 'migration failed');
      process.exit(1);
    });
}

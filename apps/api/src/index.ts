import { buildServer } from './server.js';
import { runMigrations } from './db/migrate.js';
import { config } from './config/env.js';
import { logger } from './logger.js';

async function main(): Promise<void> {
  try {
    await runMigrations();
    const server = buildServer();
    await server.listen({ host: '0.0.0.0', port: config.PORT });
    logger.info({ port: config.PORT, env: config.NODE_ENV }, 'api listening');
  } catch (err: unknown) {
    logger.error({ err }, 'failed to start api');
    process.exit(1);
  }
}

void main();

import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

async function globalSetup(): Promise<void> {
  const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
  const cli = process.env.CONTAINER_CLI ?? 'podman';
  const { status } = spawnSync(
    cli,
    ['compose', '-f', 'compose.yaml', '-f', 'compose.test.yaml', 'up', '-d', '--wait'],
    { stdio: 'inherit', cwd: repoRoot },
  );
  if (status !== 0) {
    throw new Error(`${cli} compose up failed with exit code ${String(status)}`);
  }
}

export default globalSetup;

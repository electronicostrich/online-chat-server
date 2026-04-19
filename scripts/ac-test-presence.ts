// Minimum-viable AC-test presence check. Real implementation (assertion-count
// + AC-behavior verification) tracked in GitHub issue #8. Per docs/hooks.md §4.2.
//
// On branches named `feature/AC-<ID>-<slug>`, require an e2e Playwright spec
// named `e2e/specs/AC-<ID>-*.spec.ts` to be staged OR already committed. On any
// other branch, exits 0 without checking.
//
// Exit codes: 0 = clean / not applicable, 1 = spec missing, 2 = error.

import { execSync } from 'node:child_process';

function run(cmd: string): string {
  try {
    return execSync(cmd, { encoding: 'utf-8' }).trim();
  } catch {
    return '';
  }
}

const branch = run('git rev-parse --abbrev-ref HEAD');
const match = /^feature\/(AC-[A-Z]+-[0-9]+)-/.exec(branch);
if (!match) {
  process.exit(0);
}

const acId = match[1];
if (acId === undefined) {
  process.exit(0);
}

const stagedFiles = run('git diff --cached --name-only --diff-filter=ACMR')
  .split('\n')
  .filter((s) => s.length > 0);

const hasStagedSpec = stagedFiles.some(
  (f) => f.startsWith('e2e/specs/') && f.includes(acId) && f.endsWith('.spec.ts'),
);
if (hasStagedSpec) {
  process.exit(0);
}

const committedSpec = run(`git ls-files e2e/specs/${acId}-*.spec.ts`);
if (committedSpec.length > 0) {
  process.exit(0);
}

process.stderr.write(
  `ac-test-presence: branch ${branch} expects e2e/specs/${acId}-<slug>.spec.ts to be staged\n` +
    `or already committed on the branch. Add the Playwright spec before committing.\n` +
    `Full check tracked in #8.\n`,
);
process.exit(1);

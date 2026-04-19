// ac-test-presence — closes #8. On branches named feature/AC-<ID>-<slug>,
// require an e2e Playwright spec named e2e/specs/AC-<ID>-*.spec.ts to be
// either staged or already committed, AND contain at least one expect() call
// so the spec cannot be a hollow placeholder.
//
// Per docs/hooks.md §4.2 and docs/ai-development-guardrails.md §3 (test-first).
//
// Exit codes: 0 = clean / not applicable, 1 = spec missing or empty, 2 = error.

import { readFileSync } from 'node:fs';
import { currentBranch, lsFiles, stagedFiles } from './_lib/git.js';
import type { CheckResult } from './_lib/report.js';
import { hasJsonFlag, report } from './_lib/report.js';

const SKIP = process.env['HOOKS_SKIP_AC_TEST_PRESENCE'];
if (SKIP && SKIP.length > 0 && SKIP !== '1') {
  // Acceptable skip: a non-empty reason string preserves an audit trail.
  process.stderr.write(
    `ac-test-presence: skipped (HOOKS_SKIP_AC_TEST_PRESENCE=${SKIP})\n`,
  );
  process.exit(0);
}
if (SKIP === '1') {
  process.stderr.write(
    `ac-test-presence: HOOKS_SKIP_AC_TEST_PRESENCE must carry a reason, not '1'.\n`,
  );
  process.exit(2);
}

const json = hasJsonFlag(process.argv);
const checks: CheckResult[] = [];

const branch = currentBranch();
const branchMatch = /^feature\/(AC-[A-Z]+-\d+)-/.exec(branch);
if (!branchMatch) {
  // Non-AC branches (chore/, fix/, infra/, spike/, main, develop) are out of scope.
  checks.push({
    name: 'branch-scope',
    status: 'pass',
    details: `branch ${branch || '(detached)'} is not a feature/AC-* branch — skipping`,
  });
  report('ac-test-presence', checks, { json });
}

const acId = branchMatch[1] ?? '';
const glob = `e2e/specs/${acId}-*.spec.ts`;
const staged = stagedFiles();
const stagedSpecs = staged.filter(
  (f) =>
    f.startsWith('e2e/specs/') && f.includes(`${acId}-`) && f.endsWith('.spec.ts'),
);
const committedSpecs = lsFiles(glob);
const candidateSpecs = Array.from(new Set([...stagedSpecs, ...committedSpecs]));

if (candidateSpecs.length === 0) {
  checks.push({
    name: 'spec-present',
    status: 'fail',
    details: `no ${glob} is staged or committed on branch ${branch}`,
  });
  report('ac-test-presence', checks, { json });
}

checks.push({
  name: 'spec-present',
  status: 'pass',
  details: `found: ${candidateSpecs.join(', ')}`,
});

// At least one candidate spec must contain ≥ 1 expect() call. Reading the
// staged file version would require `git show :path`; checking the working
// tree is good enough — if the spec is staged, the working tree matches.
let substantive = false;
const emptyReasons: string[] = [];
for (const path of candidateSpecs) {
  let body = '';
  try {
    body = readFileSync(path, 'utf-8');
  } catch (err) {
    emptyReasons.push(`${path}: unreadable (${String(err)})`);
    continue;
  }
  // Strip line comments and block comments before scanning, so `// expect(...)`
  // in a comment doesn't count. This is intentionally shallow — the substance
  // check in scripts/check-test-substance.ts is the deeper gate.
  const stripped = body
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
  const expectCount = (stripped.match(/\bexpect\s*\(/g) ?? []).length;
  const testCount = (stripped.match(/\b(test|it)(\.describe|\.step)?\s*\(/g) ?? []).length;
  if (expectCount >= 1 && testCount >= 1) {
    substantive = true;
    break;
  }
  emptyReasons.push(
    `${path}: ${String(testCount)} test()/it(), ${String(expectCount)} expect()`,
  );
}

if (!substantive) {
  checks.push({
    name: 'spec-has-assertion',
    status: 'fail',
    details: `no candidate spec for ${acId} contains at least one test() and one expect() — ${emptyReasons.join('; ')}`,
  });
  report('ac-test-presence', checks, { json });
}

checks.push({
  name: 'spec-has-assertion',
  status: 'pass',
  details: `${acId} spec contains ≥1 test() and ≥1 expect()`,
});
report('ac-test-presence', checks, { json });

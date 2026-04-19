// drizzle-guard — closes #7. If any file under apps/api/src/db/schema/ is
// staged, require a matching migration file under apps/api/drizzle/*.sql AND
// a staged docs/data-model.md change in the same commit. Per docs/hooks.md
// §4.2, docs/ai-development-guardrails.md §6.2, and ADR-011.
//
// Exit codes: 0 = clean / not applicable, 1 = schema staged without the
// required siblings, 2 = error.

import { stagedFiles } from './_lib/git.js';
import type { CheckResult } from './_lib/report.js';
import { hasJsonFlag, report } from './_lib/report.js';

const SKIP = process.env['HOOKS_SKIP_DRIZZLE_GUARD'];
if (SKIP && SKIP.length > 0 && SKIP !== '1') {
  process.stderr.write(`drizzle-guard: skipped (HOOKS_SKIP_DRIZZLE_GUARD=${SKIP})\n`);
  process.exit(0);
}
if (SKIP === '1') {
  process.stderr.write(
    `drizzle-guard: HOOKS_SKIP_DRIZZLE_GUARD must carry a reason, not '1'.\n`,
  );
  process.exit(2);
}

const json = hasJsonFlag(process.argv);
const checks: CheckResult[] = [];

const staged = stagedFiles();
const schemaStaged = staged.filter(
  (f) => f.startsWith('apps/api/src/db/schema/') && f.endsWith('.ts'),
);

if (schemaStaged.length === 0) {
  checks.push({
    name: 'schema-scope',
    status: 'pass',
    details: 'no apps/api/src/db/schema/**/*.ts staged — nothing to check',
  });
  report('drizzle-guard', checks, { json });
}

const migrationStaged = staged.filter(
  (f) => f.startsWith('apps/api/drizzle/') && f.endsWith('.sql'),
);
const docModelStaged = staged.includes('docs/data-model.md');

const missing: string[] = [];
if (migrationStaged.length === 0) {
  missing.push('no apps/api/drizzle/*.sql migration is staged');
}
if (!docModelStaged) {
  missing.push('no docs/data-model.md edit is staged');
}

checks.push({
  name: 'schema-has-migration',
  status: migrationStaged.length > 0 ? 'pass' : 'fail',
  details:
    migrationStaged.length > 0
      ? `staged migration(s): ${migrationStaged.join(', ')}`
      : `schema staged (${schemaStaged.join(', ')}) but no migration sibling`,
});

checks.push({
  name: 'schema-has-doc-update',
  status: docModelStaged ? 'pass' : 'fail',
  details: docModelStaged
    ? 'docs/data-model.md staged'
    : `schema staged (${schemaStaged.join(', ')}) but docs/data-model.md not staged`,
});

report('drizzle-guard', checks, { json });

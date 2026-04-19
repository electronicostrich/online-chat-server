// Minimum-viable drizzle guard. Real implementation tracked in GitHub issue #7.
// Per docs/hooks.md §4.2 and docs/ai-development-guardrails.md.
//
// If any file under apps/api/src/db/schema/ is staged, require a matching
// migration file under apps/api/drizzle/*.sql AND a staged docs/data-model.md
// change in the same commit.
//
// Exit codes: 0 = clean, 1 = schema staged without the required siblings,
// 2 = error.

import { execSync } from 'node:child_process';

function getStagedFiles(): string[] {
  try {
    return execSync('git diff --cached --name-only --diff-filter=ACMR', { encoding: 'utf-8' })
      .split('\n')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
  } catch (err) {
    process.stderr.write(`drizzle-guard: failed to read staged files: ${String(err)}\n`);
    process.exit(2);
  }
}

const staged = getStagedFiles();
const schemaStaged = staged.filter(
  (f) => f.startsWith('apps/api/src/db/schema/') && f.endsWith('.ts'),
);

if (schemaStaged.length === 0) {
  process.exit(0);
}

const migrationStaged = staged.some(
  (f) => f.startsWith('apps/api/drizzle/') && f.endsWith('.sql'),
);
const docModelStaged = staged.includes('docs/data-model.md');

if (!migrationStaged || !docModelStaged) {
  process.stderr.write(
    `drizzle-guard: schema files staged but required siblings are missing:\n` +
      `  schema files: ${schemaStaged.join(', ')}\n` +
      (!migrationStaged ? `  - no matching apps/api/drizzle/*.sql migration is staged\n` : '') +
      (!docModelStaged ? `  - no docs/data-model.md edit is staged\n` : '') +
      'Full check tracked in #7; see docs/ai-development-guardrails.md.\n',
  );
  process.exit(1);
}

process.exit(0);

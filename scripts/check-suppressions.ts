// Minimum-viable suppression scanner. Real implementation (richer grammar
// and AST-aware parsing) tracked in GitHub issue #6. Per docs/script-specs.md §7
// and docs/ai-development-guardrails.md §5.1.
//
// Invoked by the lefthook pre-commit hook with `--staged`. Scans the diff of
// staged changes for net-new lines that introduce suppression patterns
// (as any, as unknown as, @ts-ignore, @ts-nocheck, eslint-disable, or bare
// TODO/FIXME/XXX) and require each such line to carry an (#N) issue link.
//
// Exit codes: 0 = clean, 1 = violations found, 2 = error.

import { execSync } from 'node:child_process';

const SUPPRESSION_PATTERNS: RegExp[] = [
  /\beslint-disable(-next-line|-line)?\b/,
  /@ts-ignore\b/,
  /@ts-nocheck\b/,
  /\bas\s+any\b/,
  /\bas\s+unknown\s+as\b/,
  /\bTODO:\s/,
  /\bFIXME:\s/,
  /\bXXX:\s/,
];
const ISSUE_LINK_PATTERN = /\(#\d+\)/;

function getStagedUnifiedDiff(): string {
  try {
    return execSync('git diff --cached --unified=0 --no-color', { encoding: 'utf-8' });
  } catch (err) {
    process.stderr.write(`check-suppressions: failed to read git diff: ${String(err)}\n`);
    process.exit(2);
  }
}

const diff = getStagedUnifiedDiff();
const lines = diff.split('\n');
let currentFile = '';
const violations: { file: string; line: string }[] = [];

for (const line of lines) {
  if (line.startsWith('+++ b/')) {
    currentFile = line.slice(6);
    continue;
  }
  if (line.startsWith('+++') || line.startsWith('+') === false) {
    continue;
  }
  const added = line.slice(1);
  for (const pat of SUPPRESSION_PATTERNS) {
    if (pat.test(added) && !ISSUE_LINK_PATTERN.test(added)) {
      violations.push({ file: currentFile, line: added.trim() });
      break;
    }
  }
}

if (violations.length > 0) {
  process.stderr.write(
    `check-suppressions: ${String(violations.length)} new suppression(s) without an (#N) issue link:\n`,
  );
  for (const v of violations) {
    process.stderr.write(`  ${v.file}: ${v.line}\n`);
  }
  process.stderr.write('See docs/ai-development-guardrails.md §5.1; full scanner tracked in #6.\n');
  process.exit(1);
}

process.exit(0);

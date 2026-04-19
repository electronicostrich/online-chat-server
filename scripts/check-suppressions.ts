// check-suppressions — closes #6. Enforces the rule against net-new
// suppression comments and annotation-less debt markers (eslint-disable,
// @ts-ignore/@ts-nocheck/@ts-expect-error without reason, as any / as unknown
// as, and bare debt markers without issue link) per
// docs/ai-development-guardrails.md §5.1 and docs/script-specs.md §7.
//
// Two modes:
//
//   --staged                 (default for lefthook pre-commit)
//       Scan the staged unified diff; reject any net-new line matching a
//       suppression pattern that lacks a (#N) issue link.
//
//   --base <ref> --head <ref>
//       CI mode. Count suppression occurrences on each ref via `git grep -c`
//       across tracked files and reject any pattern whose count grew. Also
//       re-runs the per-line issue-link check on the base…head diff so
//       single-commit sloppiness is caught even if the aggregate count drops.
//
// Exit codes: 0 = clean, 1 = violations, 2 = error.

import { execFileSync } from 'node:child_process';
import { diffBetween, stagedUnifiedDiff } from './_lib/git.js';
import type { CheckResult } from './_lib/report.js';
import { getArg, hasJsonFlag, report } from './_lib/report.js';

type Pattern = { name: string; regex: RegExp };

const SUPPRESSION_PATTERNS: Pattern[] = [
  { name: 'eslint-disable', regex: /\beslint-disable(?:-next-line|-line)?\b/ },
  { name: '@ts-ignore', regex: /@ts-ignore\b/ },
  { name: '@ts-nocheck', regex: /@ts-nocheck\b/ },
  { name: '@ts-expect-error', regex: /@ts-expect-error\b/ },
  { name: 'as any', regex: /\bas\s+any\b/ },
  { name: 'as unknown as', regex: /\bas\s+unknown\s+as\b/ },
  { name: 'debt-marker', regex: /\b(?:TODO|FIXME|XXX):\s/ },
];

const ISSUE_LINK_PATTERN = /\(#\d+\)/;

// The `as` identifier also appears in TSX-`as const`, TS `satisfies X as Y`-ish
// shapes, `import ... as name`, etc. For the net-new scanner we want false
// negatives (miss a legitimate pattern) rather than false positives. For
// `as any`/`as unknown as` the word-boundary form above already filters well.

// Files we don't scan — lockfiles, generated code, vendored bundles.
const EXCLUDE_PATH = /(^|\/)(pnpm-lock\.yaml|\.lock|\.generated\.|dist\/|node_modules\/)/;

const SKIP = process.env['HOOKS_SKIP_SUPPRESSION_CHECK'];
if (SKIP && SKIP.length > 0 && SKIP !== '1') {
  process.stderr.write(`check-suppressions: skipped (HOOKS_SKIP_SUPPRESSION_CHECK=${SKIP})\n`);
  process.exit(0);
}
if (SKIP === '1') {
  process.stderr.write(
    `check-suppressions: HOOKS_SKIP_SUPPRESSION_CHECK must carry a reason, not '1'.\n`,
  );
  process.exit(2);
}

const argv = process.argv.slice(2);
const json = hasJsonFlag(argv);
const checks: CheckResult[] = [];
const errors: string[] = [];

type Violation = { file: string; pattern: string; snippet: string };

function scanDiff(diff: string, label: string): Violation[] {
  const violations: Violation[] = [];
  const lines = diff.split('\n');
  let currentFile = '';
  let isSuppressedFile = false;
  for (const line of lines) {
    if (line.startsWith('diff --git ')) {
      const m = /^diff --git a\/(.+?) b\/(.+?)$/.exec(line);
      currentFile = m?.[2] ?? '';
      isSuppressedFile = EXCLUDE_PATH.test(currentFile);
      continue;
    }
    if (line.startsWith('+++ b/')) {
      currentFile = line.slice(6);
      isSuppressedFile = EXCLUDE_PATH.test(currentFile);
      continue;
    }
    if (!line.startsWith('+') || line.startsWith('+++')) continue;
    if (isSuppressedFile) continue;
    // Allow scripts themselves to reference suppression patterns (so the
    // scanner definition doesn't flag itself). Markdown doc references are
    // allowed only for doc files under docs/ and the PR template.
    const isSelfDefining =
      currentFile.startsWith('scripts/') && currentFile.endsWith('.ts');
    if (isSelfDefining) continue;
    const isDocsReference =
      currentFile.startsWith('docs/') ||
      currentFile.startsWith('.github/') ||
      /\.(md|mdx)$/.test(currentFile);
    const added = line.slice(1);
    for (const pat of SUPPRESSION_PATTERNS) {
      if (!pat.regex.test(added)) continue;
      // Docs cite the patterns as rules, not as code. Still require issue-link
      // on bare debt markers inside docs so the grammar rule bites evenly.
      if (isDocsReference && pat.name !== 'debt-marker') continue;
      if (ISSUE_LINK_PATTERN.test(added)) continue;
      violations.push({
        file: `${currentFile} (${label})`,
        pattern: pat.name,
        snippet: added.trim(),
      });
      break;
    }
  }
  return violations;
}

function countInRef(ref: string, regex: RegExp): number {
  // -P enables PCRE so \b and non-capturing groups work. Requires git built
  // with PCRE support (standard on macOS Homebrew and Debian/Ubuntu apt).
  const args = [
    'grep',
    '--no-color',
    '-cIP',
    regex.source,
    ref,
    '--',
    ':!pnpm-lock.yaml',
    ':!**/*.lock',
    ':!**/*.generated.*',
    ':!node_modules/',
    ':!scripts/',
    ':!docs/',
    ':!**/*.md',
    ':!**/*.mdx',
  ];
  try {
    const out = execFileSync('git', args, { encoding: 'utf-8' });
    // `git grep -c` prints "path:count" per file.
    return out
      .split('\n')
      .map((s) => s.trim())
      .filter((s) => s.length > 0)
      .reduce((acc, line) => {
        const m = /:(\d+)$/.exec(line);
        return acc + (m ? Number(m[1]) : 0);
      }, 0);
  } catch {
    // git grep exits 1 when no matches. Treat as zero.
    return 0;
  }
}

const staged = argv.includes('--staged');
const base = getArg(argv, '--base');
const head = getArg(argv, '--head');
const mode = staged ? 'staged' : base !== undefined ? 'base-head' : 'staged';

let allViolations: Violation[] = [];

if (mode === 'staged') {
  const diff = stagedUnifiedDiff();
  allViolations = scanDiff(diff, 'staged');
  checks.push({
    name: 'staged-diff-scan',
    status: allViolations.length === 0 ? 'pass' : 'fail',
    details:
      allViolations.length === 0
        ? 'no net-new suppressions without issue links'
        : `${String(allViolations.length)} offending line(s):\n    ${allViolations
            .map((v) => `${v.file}: [${v.pattern}] ${v.snippet}`)
            .join('\n    ')}`,
  });
} else {
  const baseRef = base ?? 'origin/main';
  const headRef = head ?? 'HEAD';
  // 1. Count delta per pattern.
  const deltas: { pattern: string; base: number; head: number }[] = [];
  for (const pat of SUPPRESSION_PATTERNS) {
    const b = countInRef(baseRef, pat.regex);
    const h = countInRef(headRef, pat.regex);
    deltas.push({ pattern: pat.name, base: b, head: h });
  }
  const grew = deltas.filter((d) => d.head > d.base);
  checks.push({
    name: 'count-delta',
    status: grew.length === 0 ? 'pass' : 'fail',
    details:
      grew.length === 0
        ? `no pattern count grew between ${baseRef} and ${headRef}`
        : grew
            .map((d) => `${d.pattern}: ${String(d.base)} → ${String(d.head)}`)
            .join(', '),
  });

  // 2. Per-line issue-link check on the diff.
  const diff = diffBetween(baseRef, headRef);
  allViolations = scanDiff(diff, `${baseRef}…${headRef}`);
  checks.push({
    name: 'diff-issue-link',
    status: allViolations.length === 0 ? 'pass' : 'fail',
    details:
      allViolations.length === 0
        ? 'every net-new suppression carries an (#N) issue link'
        : `${String(allViolations.length)} offending line(s):\n    ${allViolations
            .map((v) => `${v.file}: [${v.pattern}] ${v.snippet}`)
            .join('\n    ')}`,
  });
}

report('check-suppressions', checks, { json, errors });

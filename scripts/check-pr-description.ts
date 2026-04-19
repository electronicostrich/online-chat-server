// check-pr-description — closes #5. PR title and body validator per
// docs/script-specs.md §6 and docs/git-workflow.md §7.1. Invoked by the
// CI jobs `check-pr-title` and `check-pr-description` in .github/workflows/ci.yml.
//
// Invocations supported:
//   --title "<string>"                  validate title only
//   --body "<string>" | --body-file <p> validate body only
//   --title "<string>" --body "<body>"  validate both (useful locally)
//
// Optional env var CHANGED_FILES: newline- or space-separated list of changed
// paths in the PR; if present the script enforces docs/data-model.md appears
// in "Docs updated" whenever any apps/api/drizzle/*.sql changed. Set by the
// CI workflow via `gh pr diff --name-only`.
//
// Exit codes: 0 = clean, 1 = violations, 2 = error.

import { readFileSync } from 'node:fs';
import type { CheckResult } from './_lib/report.js';
import { getArg, hasJsonFlag, report } from './_lib/report.js';
import { extractHeadings } from './_lib/markdown.js';

// Accept `chore:`, `AC-AUTH-03:`, and Conventional-Commit-style scopes
// (`chore(tooling):`) which the PO uses for PRs. The stricter plain-prefix
// form is the commit-msg hook's job (lefthook.yml commit-msg/title-format).
const TITLE_PATTERN =
  /^(AC-[A-Z]+-\d+|chore|fix|doc|infra|spike|CHORE|DOC|INFRA|SPIKE)(\([^\s)]+\))?:\s.+$/;

const REQUIRED_BODY_SECTIONS = [
  'Summary',
  'AC IDs addressed',
  'Docs updated',
  'Testing',
];

function loadBody(argv: string[]): string | undefined {
  const inline = getArg(argv, '--body');
  if (inline !== undefined) return inline;
  const file = getArg(argv, '--body-file');
  if (file !== undefined) {
    try {
      return readFileSync(file, 'utf-8');
    } catch (err) {
      throw new Error(`cannot read --body-file ${file}: ${String(err)}`);
    }
  }
  return undefined;
}

const argv = process.argv.slice(2);
const json = hasJsonFlag(argv);
const checks: CheckResult[] = [];
const errors: string[] = [];

const title = getArg(argv, '--title');
let body: string | undefined;
try {
  body = loadBody(argv);
} catch (err) {
  errors.push(String(err));
}

if (title === undefined && body === undefined && errors.length === 0) {
  errors.push('at least one of --title, --body, --body-file must be supplied');
}

if (title !== undefined) {
  if (TITLE_PATTERN.test(title.trim())) {
    checks.push({
      name: 'title-format',
      status: 'pass',
      details: `title matches ${TITLE_PATTERN.source}`,
    });
  } else {
    checks.push({
      name: 'title-format',
      status: 'fail',
      details:
        `title ${JSON.stringify(title)} must start with one of: ` +
        `AC-<ID>:, chore:, fix:, doc:, infra:, spike: (or uppercase equivalents). ` +
        `See docs/git-workflow.md §4.1.`,
    });
  }
}

if (body !== undefined) {
  const trimmed = body.trim();
  if (trimmed.length === 0) {
    checks.push({
      name: 'body-non-empty',
      status: 'fail',
      details: 'PR body is empty — required template sections missing',
    });
  } else {
    const headings = extractHeadings(body).filter((h) => h.depth === 2);
    const present = new Set(headings.map((h) => h.text.trim()));
    const missing = REQUIRED_BODY_SECTIONS.filter((s) => !present.has(s));
    if (missing.length > 0) {
      checks.push({
        name: 'body-sections',
        status: 'fail',
        details: `missing H2 section(s): ${missing.map((s) => `## ${s}`).join(', ')}`,
      });
    } else {
      checks.push({
        name: 'body-sections',
        status: 'pass',
        details: 'all required H2 sections present',
      });
    }

    // AC-<ID>: titles must list at least one AC ID under "AC IDs addressed".
    if (title !== undefined && /^AC-[A-Z]+-\d+:/.test(title.trim())) {
      const section = extractNamedSection(body, 'AC IDs addressed');
      const hasAc = section ? /\bAC-[A-Z]+-\d+\b/.test(section) : false;
      checks.push({
        name: 'ac-ids-listed',
        status: hasAc ? 'pass' : 'fail',
        details: hasAc
          ? 'at least one AC-ID referenced in AC IDs addressed'
          : 'title is AC-... but AC IDs addressed section contains no AC-<ID> reference',
      });
    }

    // If any apps/api/drizzle/*.sql changed (per CHANGED_FILES env), Docs
    // updated must mention docs/data-model.md per docs/script-specs.md §6.
    const changed = (process.env['CHANGED_FILES'] ?? '')
      .split(/[\s\n]+/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    const hasMigrationChange = changed.some(
      (f) => f.startsWith('apps/api/drizzle/') && f.endsWith('.sql'),
    );
    if (hasMigrationChange) {
      const docsSection = extractNamedSection(body, 'Docs updated') ?? '';
      const mentionsDataModel = /docs\/data-model\.md/.test(docsSection);
      checks.push({
        name: 'data-model-doc-updated',
        status: mentionsDataModel ? 'pass' : 'fail',
        details: mentionsDataModel
          ? 'Docs updated references docs/data-model.md'
          : 'migration changed (apps/api/drizzle/*.sql) but Docs updated does not mention docs/data-model.md',
      });
    }

    // ADR change → Summary must reference ADR-NNN.
    const hasAdrChange = changed.some((f) => /^docs\/adr\/ADR-\d{3}.*\.md$/.test(f));
    if (hasAdrChange) {
      const summary = extractNamedSection(body, 'Summary') ?? '';
      const referencesAdr = /ADR-\d{3}/.test(summary);
      checks.push({
        name: 'adr-referenced',
        status: referencesAdr ? 'pass' : 'fail',
        details: referencesAdr
          ? 'Summary references ADR-NNN'
          : 'an ADR file changed but Summary does not reference ADR-NNN',
      });
    }
  }
}

report('check-pr-description', checks, { json, errors });

function extractNamedSection(body: string, name: string): string | undefined {
  const lines = body.split('\n');
  let start = -1;
  let end = lines.length;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';
    if (/^##\s+/.test(line)) {
      const text = line.replace(/^##\s+/, '').trim();
      if (start === -1 && text === name) {
        start = i + 1;
      } else if (start !== -1) {
        end = i;
        break;
      }
    }
  }
  if (start === -1) return undefined;
  return lines.slice(start, end).join('\n');
}

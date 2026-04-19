// doc-coverage — closes #1. Doc-and-code consistency invariants per
// docs/script-specs.md §3 and docs/traceability.md §15. Invoked by
// `pnpm doc-consistency`, the lefthook pre-push hook, and CI.
//
// Hard checks (fail the script on mismatch — always enforceable at any stage):
//   - ac-pack-has-traceability-row — every AC in acceptance-criteria-pack.md
//     has a row in traceability.md
//   - traceability-ac-exists       — every AC cited in traceability.md exists
//     in acceptance-criteria-pack.md
//   - playwright-matches-ac        — every file in e2e/specs/AC-*.spec.ts
//     references an AC ID that exists in the pack
//
// Soft checks (warn-only at Stage-0 scaffolding; promoted to hard once the
// relevant source exists and is expected to be complete):
//   - error-code-parity            — error-codes.ts ↔ api-and-events.md §4.5
//   - event-type-parity            — events.ts ↔ api-and-events.md §6.4
//   - api-path-registered          — fastify routes ↔ api-and-events.md headings
//
// Exit codes: 0 = pass (including warns), 1 = hard-check failure, 2 = error.

import { existsSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import ts from 'typescript';
import type { CheckResult } from './_lib/report.js';
import { hasJsonFlag, report } from './_lib/report.js';
import { extractAcIds, extractHeadings, extractSection, extractTableRows } from './_lib/markdown.js';

const REPO = process.cwd();
const DOC_ACCEPTANCE = resolve(REPO, 'docs/acceptance-criteria-pack.md');
const DOC_TRACEABILITY = resolve(REPO, 'docs/traceability.md');
const DOC_API = resolve(REPO, 'docs/api-and-events.md');
const SHARED_ERROR_CODES = resolve(REPO, 'packages/shared-schemas/src/constants/error-codes.ts');
const SHARED_EVENTS = resolve(REPO, 'packages/shared-schemas/src/schemas/events.ts');
const API_ROUTES_GLOB = 'apps/api/src/**/routes.ts';

function readIfExists(path: string): string | undefined {
  try {
    return readFileSync(path, 'utf-8');
  } catch {
    return undefined;
  }
}

function listFiles(glob: string): string[] {
  try {
    const out = execFileSync('git', ['ls-files', '--', glob], { encoding: 'utf-8' });
    return out
      .split('\n')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
  } catch {
    return [];
  }
}

const argv = process.argv.slice(2);
const json = hasJsonFlag(argv);
const checks: CheckResult[] = [];
const errors: string[] = [];

const pack = readIfExists(DOC_ACCEPTANCE);
const trace = readIfExists(DOC_TRACEABILITY);
const api = readIfExists(DOC_API);

if (pack === undefined) errors.push('cannot read docs/acceptance-criteria-pack.md');
if (trace === undefined) errors.push('cannot read docs/traceability.md');
if (api === undefined) errors.push('cannot read docs/api-and-events.md');

// ─── Hard: AC-pack ↔ traceability parity ────────────────────────────────────
if (pack !== undefined && trace !== undefined) {
  const packIds = new Set<string>();
  for (const h of extractHeadings(pack)) {
    const m = /\bAC-[A-Z]+-\d+\b/.exec(h.text);
    if (m) packIds.add(m[0]);
  }
  const traceIds = extractAcIds(trace);

  const missingInTrace = [...packIds].filter((id) => !traceIds.has(id)).sort();
  checks.push({
    name: 'ac-pack-has-traceability-row',
    status: missingInTrace.length === 0 ? 'pass' : 'fail',
    details:
      missingInTrace.length === 0
        ? `${String(packIds.size)} AC ID(s) in the pack all have a traceability row`
        : `AC(s) in pack but missing from traceability.md: ${missingInTrace.join(', ')}`,
  });

  const extraInTrace = [...traceIds].filter((id) => !packIds.has(id)).sort();
  checks.push({
    name: 'traceability-ac-exists',
    status: extraInTrace.length === 0 ? 'pass' : 'fail',
    details:
      extraInTrace.length === 0
        ? 'every AC ID cited in traceability.md exists in the pack'
        : `AC(s) in traceability.md but missing from pack: ${extraInTrace.join(', ')}`,
  });

  // ─── Hard: every Playwright spec matches an AC ID ────────────────────────
  const specs = listFiles('e2e/specs');
  const specPattern = /^e2e\/specs\/(AC-[A-Z]+-\d+)-.*\.spec\.ts$/;
  const unmatched: string[] = [];
  for (const spec of specs) {
    const m = specPattern.exec(spec);
    if (!m) {
      unmatched.push(`${spec}: filename does not match AC-<ID>-<slug>.spec.ts`);
      continue;
    }
    if (!packIds.has(m[1] ?? '')) {
      unmatched.push(`${spec}: AC ID ${m[1] ?? ''} not in acceptance-criteria-pack.md`);
    }
  }
  checks.push({
    name: 'playwright-matches-ac',
    status: unmatched.length === 0 ? 'pass' : 'fail',
    details:
      unmatched.length === 0
        ? `${String(specs.length)} Playwright spec(s) all name an AC in the pack`
        : unmatched.join('; '),
  });
}

// ─── Soft: error code parity ────────────────────────────────────────────────
if (api !== undefined) {
  if (!existsSync(SHARED_ERROR_CODES)) {
    checks.push({
      name: 'error-code-parity',
      status: 'warn',
      details: 'packages/shared-schemas/src/constants/error-codes.ts missing — skipping',
    });
  } else {
    const codeText = readIfExists(SHARED_ERROR_CODES) ?? '';
    const codeSet = new Set<string>();
    for (const m of codeText.matchAll(/^\s*([A-Z_][A-Z0-9_]*):\s*'[A-Z_]+'/gm)) {
      codeSet.add(m[1] ?? '');
    }
    const docCodes = new Set<string>();
    const section = extractSection(api, /^4\.5\s+Error code catalogue/);
    if (section) {
      for (const row of extractTableRows(section.lines.join('\n'))) {
        const first = (row.cells[0] ?? '').replace(/`/g, '').trim();
        if (/^[A-Z_][A-Z0-9_]*$/.test(first) && first !== 'Code') docCodes.add(first);
      }
    }
    const missingInCode = [...docCodes].filter((c) => !codeSet.has(c)).sort();
    const missingInDoc = [...codeSet].filter((c) => !docCodes.has(c)).sort();
    const issues = [];
    if (missingInCode.length > 0) issues.push(`in docs only: ${missingInCode.join(', ')}`);
    if (missingInDoc.length > 0) issues.push(`in error-codes.ts only: ${missingInDoc.join(', ')}`);
    // At Stage-0 the shared-schemas error-codes union is intentionally a
    // subset of the doc catalogue — workstreams add codes as they land. Warn
    // rather than fail until WS-02 is complete.
    checks.push({
      name: 'error-code-parity',
      status: issues.length === 0 ? 'pass' : 'warn',
      details:
        issues.length === 0
          ? `${String(codeSet.size)} code(s) match docs §4.5`
          : issues.join('; '),
    });
  }
}

// ─── Soft: event type parity ────────────────────────────────────────────────
if (api !== undefined) {
  if (!existsSync(SHARED_EVENTS)) {
    checks.push({
      name: 'event-type-parity',
      status: 'warn',
      details: 'packages/shared-schemas/src/schemas/events.ts missing — event schemas not yet landed',
    });
  } else {
    const eventsText = readIfExists(SHARED_EVENTS) ?? '';
    const schemaEventNames = new Set<string>();
    for (const m of eventsText.matchAll(/Type\.Literal\(\s*['"]([a-z][a-z0-9.]*)['"]\s*\)/g)) {
      schemaEventNames.add(m[1] ?? '');
    }
    const docEventNames = new Set<string>();
    const section = extractSection(api, /^6\.4\s+Event types/);
    if (section) {
      for (const h of extractHeadings(section.lines.join('\n'))) {
        if (h.depth === 3) {
          const m = /`([a-z][a-z0-9.]*)`/.exec(h.text);
          if (m) docEventNames.add(m[1] ?? '');
        }
      }
    }
    const missingInSchema = [...docEventNames].filter((n) => !schemaEventNames.has(n)).sort();
    const missingInDoc = [...schemaEventNames].filter((n) => !docEventNames.has(n)).sort();
    const issues = [];
    if (missingInSchema.length > 0) issues.push(`in docs only: ${missingInSchema.join(', ')}`);
    if (missingInDoc.length > 0) issues.push(`in events.ts only: ${missingInDoc.join(', ')}`);
    checks.push({
      name: 'event-type-parity',
      status: issues.length === 0 ? 'pass' : 'warn',
      details:
        issues.length === 0
          ? `${String(schemaEventNames.size)} event type(s) match docs §6.4`
          : issues.join('; '),
    });
  }
}

// ─── Soft: fastify routes ↔ api-and-events headings ─────────────────────────
if (api !== undefined) {
  const routeFiles = listFiles(API_ROUTES_GLOB).concat(listFiles('apps/api/src/routes'));
  const registeredRoutes = new Set<string>();
  for (const path of routeFiles) {
    if (!path.endsWith('.ts')) continue;
    const src = readIfExists(path) ?? '';
    if (src.length === 0) continue;
    const sf = ts.createSourceFile(path, src, ts.ScriptTarget.ES2023, true);
    const visit = (node: ts.Node): void => {
      if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
        const methodName = node.expression.name.text.toUpperCase();
        if (['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(methodName)) {
          const firstArg = node.arguments[0];
          if (firstArg && ts.isStringLiteralLike(firstArg)) {
            registeredRoutes.add(`${methodName} ${firstArg.text}`);
          }
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
  }

  const docRoutes = new Set<string>();
  for (const h of extractHeadings(api)) {
    if (h.depth !== 3) continue;
    const m = /^(GET|POST|PUT|PATCH|DELETE)\s+`([^`]+)`/.exec(h.text);
    if (m) docRoutes.add(`${m[1] ?? ''} ${m[2] ?? ''}`);
  }

  // Normalize path params (:id, {id}, {roomId} → :PARAM) so `/rooms/{roomId}`
  // in docs matches `/rooms/:roomId` in Fastify.
  const normalize = (r: string): string =>
    r.replace(/[:{][^/}]+[}]?/g, ':P');

  const normalizedDoc = new Set([...docRoutes].map(normalize));
  const notInDoc = [...registeredRoutes].filter((r) => {
    if (r.startsWith('GET /healthz')) return false;
    if (r.includes('/__test/')) return false; // test-only, intentional
    return !normalizedDoc.has(normalize(r));
  });
  checks.push({
    name: 'api-path-registered',
    status: notInDoc.length === 0 ? 'pass' : 'warn',
    details:
      notInDoc.length === 0
        ? registeredRoutes.size === 0
          ? 'no Fastify routes registered yet (Stage-0 expected)'
          : `${String(registeredRoutes.size)} registered route(s) all have a heading in api-and-events.md`
        : `registered but not documented: ${notInDoc.join(', ')}`,
  });
}

report('doc-coverage', checks, { json, errors });

// check-test-substance — closes #4. Every Playwright spec under e2e/specs/
// must contain at least one test() block, each test block must have at least
// one expect() assertion, and no test may rely solely on tautologies like
// expect(true).toBe(true). Per docs/script-specs.md §8 and
// docs/ai-development-guardrails.md §5.6.
//
// Also honours --staged (the lefthook / CI pre-commit mode): when --staged is
// passed, only files staged in the current diff are scanned, narrowing the
// work in interactive loops.
//
// Uses the typescript compiler API (installed as a root devDependency) for
// AST traversal — regex alone would mis-classify `expect` mentions inside
// comments or multi-line template strings.
//
// Exit codes: 0 = clean, 1 = violations, 2 = error.

import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import ts from 'typescript';
import { stagedFiles } from './_lib/git.js';
import type { CheckResult } from './_lib/report.js';
import { hasJsonFlag, report } from './_lib/report.js';

const TAUTOLOGY_PATTERNS: RegExp[] = [
  /^expect\(\s*true\s*\)\.toBe\(\s*true\s*\)$/,
  /^expect\(\s*false\s*\)\.toBe\(\s*false\s*\)$/,
  /^expect\(\s*1\s*\)\.toBe\(\s*1\s*\)$/,
  /^expect\(\s*1\s*\)\.toBeTruthy\(\s*\)$/,
  /^expect\(\s*0\s*\)\.toBeFalsy\(\s*\)$/,
  /^expect\(\s*\[\s*\]\s*\)\.toEqual\(\s*\[\s*\]\s*\)$/,
  /^expect\(\s*\{\s*\}\s*\)\.toEqual\(\s*\{\s*\}\s*\)$/,
];

function normalise(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

type TestBlock = {
  name: string;
  line: number;
  expectCalls: string[];
  nonTautologyExpects: number;
  hasSkipOrOnly: boolean;
};

function listAllSpecs(): string[] {
  try {
    const out = execFileSync('git', ['ls-files', '--', 'e2e/specs/'], {
      encoding: 'utf-8',
    });
    return out
      .split('\n')
      .map((s) => s.trim())
      .filter((s) => s.length > 0 && s.endsWith('.spec.ts'));
  } catch {
    return [];
  }
}

function scanFile(path: string): { blocks: TestBlock[]; error?: string } {
  let source = '';
  try {
    source = readFileSync(path, 'utf-8');
  } catch (err) {
    return { blocks: [], error: `cannot read ${path}: ${String(err)}` };
  }
  const sf = ts.createSourceFile(path, source, ts.ScriptTarget.ES2023, true);
  const blocks: TestBlock[] = [];

  function getCalleeName(callee: ts.Expression): string {
    // test, it, test.step, test.describe, test.skip, test.only, test.describe.only
    if (ts.isIdentifier(callee)) return callee.text;
    if (ts.isPropertyAccessExpression(callee)) {
      return `${getCalleeName(callee.expression)}.${callee.name.text}`;
    }
    return '';
  }

  function walk(node: ts.Node, currentBlock?: TestBlock): void {
    if (ts.isCallExpression(node)) {
      const name = getCalleeName(node.expression);
      // A spec entry point.
      if (
        name === 'test' ||
        name === 'it' ||
        name === 'test.step' ||
        name === 'test.describe' ||
        name === 'test.skip' ||
        name === 'test.only' ||
        name === 'test.describe.only' ||
        name === 'test.describe.skip' ||
        name === 'it.skip' ||
        name === 'it.only'
      ) {
        const firstArg = node.arguments[0];
        const testName =
          firstArg && ts.isStringLiteralLike(firstArg) ? firstArg.text : '(anonymous)';
        const { line } = sf.getLineAndCharacterOfPosition(node.getStart(sf));
        const block: TestBlock = {
          name: `${name}: ${testName}`,
          line: line + 1,
          expectCalls: [],
          nonTautologyExpects: 0,
          hasSkipOrOnly: name.includes('.skip') || name.includes('.only'),
        };
        blocks.push(block);
        ts.forEachChild(node, (child) => {
          walk(child, block);
        });
        return;
      }
      // expect(...) invocation — possibly chained (.toBe, .toEqual, ...). We
      // want the full chain text to detect tautologies.
      if (currentBlock !== undefined && name === 'expect') {
        const topCall = findChainTop(node);
        const chainText = normalise(topCall.getText(sf));
        currentBlock.expectCalls.push(chainText);
        if (!TAUTOLOGY_PATTERNS.some((p) => p.test(chainText))) {
          currentBlock.nonTautologyExpects += 1;
        }
      }
    }
    ts.forEachChild(node, (child) => {
      walk(child, currentBlock);
    });
  }

  function findChainTop(node: ts.Node): ts.Node {
    let top: ts.Node = node;
    // node.parent is typed non-nullable by ts-morph/ts but is undefined at the root.
    while (ts.isPropertyAccessExpression(top.parent) || ts.isCallExpression(top.parent)) {
      top = top.parent;
    }
    return top;
  }

  walk(sf);
  return { blocks };
}

const argv = process.argv.slice(2);
const json = hasJsonFlag(argv);
const useStaged = argv.includes('--staged');

let targets: string[] = [];
if (useStaged) {
  targets = stagedFiles().filter(
    (f) => f.startsWith('e2e/specs/') && f.endsWith('.spec.ts'),
  );
} else {
  targets = listAllSpecs();
}

const checks: CheckResult[] = [];
const errors: string[] = [];

if (targets.length === 0) {
  checks.push({
    name: 'specs-scanned',
    status: 'pass',
    details: useStaged ? 'no e2e specs staged' : 'no e2e specs found',
  });
  report('check-test-substance', checks, { json, errors });
}

type Violation = { file: string; block: string; line: number; reason: string };
const violations: Violation[] = [];

for (const path of targets) {
  const { blocks, error } = scanFile(path);
  if (error) {
    errors.push(error);
    continue;
  }
  if (blocks.length === 0) {
    violations.push({
      file: path,
      block: '(file)',
      line: 1,
      reason: 'no test()/it() blocks found',
    });
    continue;
  }
  for (const block of blocks) {
    if (block.hasSkipOrOnly) {
      violations.push({
        file: path,
        block: block.name,
        line: block.line,
        reason: 'uses .skip or .only — not allowed in committed specs',
      });
    }
    if (block.expectCalls.length === 0) {
      violations.push({
        file: path,
        block: block.name,
        line: block.line,
        reason: 'no expect() calls',
      });
      continue;
    }
    if (block.nonTautologyExpects === 0) {
      violations.push({
        file: path,
        block: block.name,
        line: block.line,
        reason: `only tautological expect()s — examples: ${block.expectCalls.slice(0, 2).join(' | ')}`,
      });
    }
  }
}

if (violations.length > 0) {
  checks.push({
    name: 'specs-have-substance',
    status: 'fail',
    details: violations
      .map((v) => `${v.file}:${String(v.line)} ${v.block} — ${v.reason}`)
      .join('\n    '),
  });
  report('check-test-substance', checks, { json, errors });
}

checks.push({
  name: 'specs-have-substance',
  status: 'pass',
  details: `${String(targets.length)} spec file(s) scanned — all blocks have ≥1 non-tautology expect()`,
});
report('check-test-substance', checks, { json, errors });

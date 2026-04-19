import { execFileSync } from 'node:child_process';

export function runGit(args: string[]): string {
  try {
    return execFileSync('git', args, { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch {
    return '';
  }
}

export function stagedFiles(): string[] {
  return runGit(['diff', '--cached', '--name-only', '--diff-filter=ACMR'])
    .split('\n')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

export function currentBranch(): string {
  return runGit(['rev-parse', '--abbrev-ref', 'HEAD']).trim();
}

export function stagedUnifiedDiff(): string {
  return runGit(['diff', '--cached', '--unified=0', '--no-color']);
}

export function diffBetween(base: string, head: string): string {
  return runGit(['diff', '--unified=0', '--no-color', `${base}...${head}`]);
}

export function hasCommitted(pathspec: string): boolean {
  const out = runGit(['ls-files', '--', pathspec]).trim();
  return out.length > 0;
}

export function lsFiles(pathspec: string): string[] {
  return runGit(['ls-files', '--', pathspec])
    .split('\n')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

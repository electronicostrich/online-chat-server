// Shared output helper for scripts/*.ts. Implements the format contract in
// docs/script-specs.md §2.2 — human-readable lines for a TTY, single JSON
// object when --json is set or when stdout is piped in CI.

export type CheckStatus = 'pass' | 'fail' | 'warn';
export type ScriptStatus = 'pass' | 'fail' | 'error';

export type CheckResult = {
  name: string;
  status: CheckStatus;
  details?: string;
};

export type ReportOptions = {
  json?: boolean;
  errors?: string[];
};

function worstStatus(checks: CheckResult[]): ScriptStatus {
  if (checks.some((c) => c.status === 'fail')) return 'fail';
  return 'pass';
}

function statusSymbol(status: CheckStatus): string {
  if (status === 'pass') return '✓';
  if (status === 'warn') return '~';
  return '✗';
}

export function report(script: string, checks: CheckResult[], opts: ReportOptions = {}): never {
  const errors = opts.errors ?? [];
  const scriptStatus: ScriptStatus = errors.length > 0 ? 'error' : worstStatus(checks);
  const useJson = Boolean(opts.json) || !process.stdout.isTTY;

  if (useJson) {
    const payload = { script, status: scriptStatus, checks, errors };
    process.stdout.write(`${JSON.stringify(payload)}\n`);
  } else {
    for (const c of checks) {
      const line = `${statusSymbol(c.status)} ${c.name}${c.details ? ` — ${c.details}` : ''}`;
      if (c.status === 'fail') {
        process.stderr.write(`${line}\n`);
      } else {
        process.stdout.write(`${line}\n`);
      }
    }
    for (const e of errors) {
      process.stderr.write(`ERROR: ${e}\n`);
    }
    const passed = checks.filter((c) => c.status === 'pass').length;
    const failed = checks.filter((c) => c.status === 'fail').length;
    const warned = checks.filter((c) => c.status === 'warn').length;
    const summary = `${script}: ${String(passed)} pass, ${String(failed)} fail, ${String(warned)} warn`;
    if (scriptStatus === 'fail' || scriptStatus === 'error') {
      process.stderr.write(`${summary}\n`);
    } else {
      process.stdout.write(`${summary}\n`);
    }
  }

  if (scriptStatus === 'error') process.exit(2);
  if (scriptStatus === 'fail') process.exit(1);
  process.exit(0);
}

export function hasJsonFlag(argv: string[]): boolean {
  return argv.includes('--json');
}

export function getArg(argv: string[], name: string): string | undefined {
  const idx = argv.indexOf(name);
  if (idx === -1 || idx === argv.length - 1) return undefined;
  return argv[idx + 1];
}

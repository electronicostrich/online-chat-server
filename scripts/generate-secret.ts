// Generate a cryptographically random secret. Used by dev-bootstrap.sh to
// populate SESSION_SECRET / CSRF_SECRET in .env.local. Per docs/script-specs.md §10.
//
// Usage: tsx scripts/generate-secret.ts [--bytes N] [--format hex|base64]
//        defaults: --bytes 32 --format hex
// Exit codes: 0 = ok, 2 = arg error.

import { randomBytes } from 'node:crypto';

const args = process.argv.slice(2);
let bytes = 32;
let format: 'hex' | 'base64' = 'hex';

const bytesIdx = args.indexOf('--bytes');
if (bytesIdx >= 0) {
  const val = args[bytesIdx + 1];
  if (val === undefined) {
    process.stderr.write('generate-secret: --bytes requires a value\n');
    process.exit(2);
  }
  const parsed = Number(val);
  if (!Number.isInteger(parsed) || parsed < 1) {
    process.stderr.write('generate-secret: --bytes must be a positive integer\n');
    process.exit(2);
  }
  bytes = parsed;
}

const formatIdx = args.indexOf('--format');
if (formatIdx >= 0) {
  const val = args[formatIdx + 1];
  if (val !== 'hex' && val !== 'base64') {
    process.stderr.write('generate-secret: --format must be hex or base64\n');
    process.exit(2);
  }
  format = val;
}

process.stdout.write(randomBytes(bytes).toString(format) + '\n');

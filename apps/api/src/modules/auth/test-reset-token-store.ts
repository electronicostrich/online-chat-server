// In-memory capture of the most recent raw password-reset token per email,
// only used when NODE_ENV=test so Playwright can drive the reset flow without
// real SMTP. Production code paths never call record() (the guard is the
// check in service.ts before invocation), and the test-only /__test/...
// inspector route is only registered under NODE_ENV=test in test-seed.ts.

const latestByEmailCanonical = new Map<string, string>();

export function recordTestResetToken(
  emailCanonical: string,
  token: string,
): void {
  if (process.env.NODE_ENV !== 'test') return;
  latestByEmailCanonical.set(emailCanonical, token);
}

export function readTestResetToken(
  emailCanonical: string,
): string | undefined {
  // Defence-in-depth: the /__test/last-reset-token route is already gated
  // on NODE_ENV=test, but mirroring the write-side guard here means any
  // future caller that forgets that contract still can't leak tokens in
  // production.
  if (process.env.NODE_ENV !== 'test') return undefined;
  return latestByEmailCanonical.get(emailCanonical);
}

export function clearTestResetTokens(): void {
  latestByEmailCanonical.clear();
}

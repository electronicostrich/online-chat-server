// In-memory capture of the most recent raw password-reset token per email,
// only used when NODE_ENV=test so Playwright can drive the reset flow without
// real SMTP. service.ts calls recordTestResetToken() unconditionally on every
// successful reset issuance; the NODE_ENV=test guards live HERE (both record
// and read are no-ops outside 'test'), so a caller accidentally wiring this
// module into a production path still cannot leak tokens. The inspector
// route `/__test/last-reset-token` is only registered under NODE_ENV=test in
// apps/api/src/routes/test-seed.ts, which is the second line of defence.

const latestByEmailCanonical = new Map<string, string>();

export function recordTestResetToken(
  emailCanonical: string,
  token: string,
): void {
  // Inert outside the test harness. See module-level comment for rationale.
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

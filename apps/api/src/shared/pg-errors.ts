// Shared Postgres error helpers. Pulled out of per-module repositories
// so translation of DB errors into domain codes (`23505 → CONFLICT`, etc.)
// stays consistent across services as the feature surface grows.

export function isUniqueViolation(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) return false;
  const code = (err as { code?: unknown }).code;
  return typeof code === 'string' && code === '23505';
}

export function extractPgConstraint(err: unknown): string | undefined {
  if (typeof err !== 'object' || err === null) return undefined;
  const maybe = err as { constraint_name?: unknown; constraint?: unknown };
  if (typeof maybe.constraint_name === 'string') return maybe.constraint_name;
  if (typeof maybe.constraint === 'string') return maybe.constraint;
  return undefined;
}

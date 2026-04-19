import { ErrorCodes } from 'shared-schemas';
import { config } from '../../config/env.js';
import type { SessionRow, UserRow } from '../../db/schema/index.js';
import { normalizeEmail, normalizeUsername } from './normalize.js';
import {
  hashPassword,
  passwordMeetsComplexity,
  verifyPassword,
} from './password.js';
import {
  findActiveSessionByTokenHash,
  findResetTokenByHash,
  findUserByEmailCanonical,
  findUserByUsernameCanonical,
  insertPasswordResetToken,
  insertSession,
  insertUser,
  listActiveSessionsForUser,
  markResetTokenConsumed,
  revokeActiveResetTokensForUser,
  revokeAllSessionsForUser,
  revokeSessionById,
  revokeSessionsForUserExcept,
  touchSessionLastSeen,
  updateUserPasswordHash,
} from './repository.js';
import {
  generateResetToken,
  generateSessionToken,
  hashResetToken,
  hashSessionToken,
} from './tokens.js';
import { recordTestResetToken } from './test-reset-token-store.js';

export class AuthError extends Error {
  public readonly statusCode: number;
  public readonly code: (typeof ErrorCodes)[keyof typeof ErrorCodes];
  public readonly details?: Record<string, unknown>;

  constructor(
    code: AuthError['code'],
    statusCode: number,
    message: string,
    details?: Record<string, unknown>,
  ) {
    super(message);
    this.code = code;
    this.statusCode = statusCode;
    if (details !== undefined) {
      this.details = details;
    }
  }
}

export interface RegisterInput {
  email: string;
  username: string;
  password: string;
  userAgent?: string | null;
  ipAddress?: string | null;
}

export interface LoginInput {
  email: string;
  password: string;
  userAgent?: string | null;
  ipAddress?: string | null;
}

export interface SessionIssued {
  user: UserRow;
  session: SessionRow;
  sessionToken: string;
}

function publicUser(user: UserRow): { id: string; email: string; username: string } {
  return { id: user.id, email: user.email, username: user.username };
}

export function toPublicUser(user: UserRow): ReturnType<typeof publicUser> {
  return publicUser(user);
}

export function toPublicSession(session: SessionRow): {
  id: string;
  createdAt: string;
} {
  return { id: session.id, createdAt: session.createdAt.toISOString() };
}

async function issueSession(
  user: UserRow,
  userAgent: string | null,
  ipAddress: string | null,
): Promise<SessionIssued> {
  const sessionToken = generateSessionToken();
  const expiresAt = new Date(Date.now() + config.SESSION_TTL_SECONDS * 1000);
  const session = await insertSession({
    userId: user.id,
    sessionTokenHash: hashSessionToken(sessionToken),
    userAgent,
    ipAddress,
    expiresAt,
  });
  return { user, session, sessionToken };
}

export async function registerUser(input: RegisterInput): Promise<SessionIssued> {
  if (!passwordMeetsComplexity(input.password)) {
    throw new AuthError(
      ErrorCodes.VALIDATION_ERROR,
      400,
      'Password does not meet complexity requirements',
      {
        fieldErrors: {
          '/password':
            'must contain at least three of: lowercase, uppercase, digit, non-alphanumeric',
        },
      },
    );
  }

  const emailCanonical = normalizeEmail(input.email);
  const usernameCanonical = normalizeUsername(input.username);

  const [emailConflict, usernameConflict] = await Promise.all([
    findUserByEmailCanonical(emailCanonical),
    findUserByUsernameCanonical(usernameCanonical),
  ]);

  if (emailConflict !== undefined) {
    throw new AuthError(ErrorCodes.CONFLICT, 409, 'Email is already in use', {
      field: 'email',
    });
  }
  if (usernameConflict !== undefined) {
    throw new AuthError(ErrorCodes.CONFLICT, 409, 'Username is already in use', {
      field: 'username',
    });
  }

  const passwordHash = await hashPassword(input.password);
  let user: UserRow;
  try {
    user = await insertUser({
      email: input.email.trim(),
      emailCanonical,
      username: input.username.trim(),
      usernameCanonical,
      passwordHash,
    });
  } catch (err: unknown) {
    // Concurrent registrations with the same canonical email/username can
    // slip past the pre-check and collide at the unique index. Translate the
    // Postgres unique_violation (SQLSTATE 23505) into a CONFLICT with a
    // best-effort field attribution derived from the constraint name.
    const pgCode = extractPgErrorCode(err);
    const pgConstraint = extractPgConstraint(err);
    if (pgCode === '23505') {
      const field = pgConstraint !== undefined && /username/u.test(pgConstraint)
        ? 'username'
        : 'email';
      throw new AuthError(
        ErrorCodes.CONFLICT,
        409,
        field === 'username'
          ? 'Username is already in use'
          : 'Email is already in use',
        { field },
      );
    }
    throw err;
  }

  return issueSession(user, input.userAgent ?? null, input.ipAddress ?? null);
}

function extractPgErrorCode(err: unknown): string | undefined {
  if (typeof err !== 'object' || err === null) return undefined;
  const maybe = (err as { code?: unknown }).code;
  return typeof maybe === 'string' ? maybe : undefined;
}

function extractPgConstraint(err: unknown): string | undefined {
  if (typeof err !== 'object' || err === null) return undefined;
  const maybe = (err as { constraint_name?: unknown; constraint?: unknown });
  if (typeof maybe.constraint_name === 'string') return maybe.constraint_name;
  if (typeof maybe.constraint === 'string') return maybe.constraint;
  return undefined;
}

// Stable argon2id hash of a value the attacker cannot learn, used to keep
// the response-time profile of "user doesn't exist" matched to the real
// verifyPassword path. Pre-computed at boot so no extra CPU is spent.
// The plaintext used to seed it is the SESSION_SECRET, which never leaves
// the server and would produce the same hash across restarts; we don't need
// the hash to round-trip, only to take comparable time to verify against.
let loginDummyHashPromise: Promise<string> | undefined;
function getLoginDummyHash(): Promise<string> {
  if (loginDummyHashPromise === undefined) {
    loginDummyHashPromise = hashPassword(
      `login-dummy:${config.SESSION_SECRET}`,
    );
  }
  return loginDummyHashPromise;
}

export async function loginUser(input: LoginInput): Promise<SessionIssued> {
  const emailCanonical = normalizeEmail(input.email);
  const user = await findUserByEmailCanonical(emailCanonical);
  const hashToVerify =
    user !== undefined && user.status === 'active'
      ? user.passwordHash
      : await getLoginDummyHash();
  const ok = await verifyPassword(hashToVerify, input.password);
  if (user === undefined || user.status !== 'active' || !ok) {
    throw new AuthError(
      ErrorCodes.UNAUTHENTICATED,
      401,
      'Invalid email or password',
    );
  }
  return issueSession(user, input.userAgent ?? null, input.ipAddress ?? null);
}

export interface ResolvedSession {
  user: UserRow;
  session: SessionRow;
}

export async function resolveSessionByToken(
  rawToken: string,
): Promise<ResolvedSession | undefined> {
  const row = await findActiveSessionByTokenHash(hashSessionToken(rawToken));
  if (row === undefined) return undefined;
  if (row.expiresAt.getTime() <= Date.now()) {
    // expired by server policy; revoke lazily so subsequent lookups are cheap
    await revokeSessionById(row.id);
    return undefined;
  }
  // Best-effort last_seen_at touch; ignore failures so a stale DB connection
  // never trips an authenticated request.
  void touchSessionLastSeen(row.id).catch(() => undefined);
  const { user, ...session } = row;
  return { user, session };
}

export async function revokeSession(sessionId: string): Promise<void> {
  await revokeSessionById(sessionId);
}

export async function listSessions(userId: string): Promise<SessionRow[]> {
  return listActiveSessionsForUser(userId);
}

export interface ChangePasswordInput {
  user: UserRow;
  currentSessionId: string;
  currentPassword: string;
  newPassword: string;
}

// Password-reset tokens live 1 hour. runtime-and-environment.md leaves the
// exact TTL unspecified; 1h matches common industry defaults and stays well
// under the 24h nightly cleanup job's window.
export const PASSWORD_RESET_TTL_MS = 60 * 60 * 1000;

export interface IssueResetTokenResult {
  tokenDelivered: string | null;
  userExists: boolean;
}

// Always resolves without throwing. If the email doesn't match a user, we
// return userExists:false but expose no signal to the caller — the endpoint
// wraps this into an indistinguishable 200 to prevent address enumeration.
export async function issuePasswordResetToken(
  emailRaw: string,
): Promise<IssueResetTokenResult> {
  const emailCanonical = normalizeEmail(emailRaw);
  const user = await findUserByEmailCanonical(emailCanonical);
  if (user === undefined || user.status !== 'active') {
    return { tokenDelivered: null, userExists: false };
  }
  // Invalidate any prior unconsumed tokens for this user before minting a
  // fresh one. This matches the user-facing expectation that requesting a
  // new reset supersedes any earlier email, and narrows the window in which
  // a leaked or still-undelivered token could be abused.
  await revokeActiveResetTokensForUser(user.id);
  const raw = generateResetToken();
  await insertPasswordResetToken({
    userId: user.id,
    tokenHash: hashResetToken(raw),
    expiresAt: new Date(Date.now() + PASSWORD_RESET_TTL_MS),
  });
  recordTestResetToken(emailCanonical, raw);
  return { tokenDelivered: raw, userExists: true };
}

export async function confirmPasswordReset(
  token: string,
  newPassword: string,
): Promise<void> {
  if (!passwordMeetsComplexity(newPassword)) {
    throw new AuthError(
      ErrorCodes.VALIDATION_ERROR,
      400,
      'Password does not meet complexity requirements',
      {
        fieldErrors: {
          '/newPassword':
            'must contain at least three of: lowercase, uppercase, digit, non-alphanumeric',
        },
      },
    );
  }
  const row = await findResetTokenByHash(hashResetToken(token));
  if (
    row === undefined ||
    row.consumedAt !== null ||
    row.revokedAt !== null ||
    row.expiresAt.getTime() <= Date.now()
  ) {
    // Single error shape per api-and-events.md §5.1 password-reset/confirm:
    // no distinction between "unknown", "consumed", or "expired".
    throw new AuthError(
      ErrorCodes.VALIDATION_ERROR,
      400,
      'Reset token is invalid or expired.',
    );
  }
  const newHash = await hashPassword(newPassword);
  await updateUserPasswordHash(row.userId, newHash);
  await markResetTokenConsumed(row.id);
  // Any sibling reset tokens become invalid the moment the account resets.
  // markResetTokenConsumed took care of `row` itself; this clears siblings.
  await revokeActiveResetTokensForUser(row.userId);
  await revokeAllSessionsForUser(row.userId);
}

export async function changePassword(input: ChangePasswordInput): Promise<void> {
  const ok = await verifyPassword(input.user.passwordHash, input.currentPassword);
  if (!ok) {
    throw new AuthError(
      ErrorCodes.FORBIDDEN,
      403,
      'Current password is incorrect.',
      { reason: 'currentPasswordInvalid' },
    );
  }
  if (input.currentPassword === input.newPassword) {
    throw new AuthError(
      ErrorCodes.VALIDATION_ERROR,
      400,
      'New password must differ from the current password.',
      { fieldErrors: { '/newPassword': 'must differ from currentPassword' } },
    );
  }
  if (!passwordMeetsComplexity(input.newPassword)) {
    throw new AuthError(
      ErrorCodes.VALIDATION_ERROR,
      400,
      'Password does not meet complexity requirements',
      {
        fieldErrors: {
          '/newPassword':
            'must contain at least three of: lowercase, uppercase, digit, non-alphanumeric',
        },
      },
    );
  }
  const newHash = await hashPassword(input.newPassword);
  await updateUserPasswordHash(input.user.id, newHash);
  await revokeSessionsForUserExcept(input.user.id, input.currentSessionId);
}

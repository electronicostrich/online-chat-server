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
  findUserByEmailCanonical,
  findUserByUsernameCanonical,
  insertSession,
  insertUser,
  listActiveSessionsForUser,
  revokeSessionById,
  touchSessionLastSeen,
} from './repository.js';
import {
  generateSessionToken,
  hashSessionToken,
} from './tokens.js';

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
  const user = await insertUser({
    email: input.email.trim(),
    emailCanonical,
    username: input.username.trim(),
    usernameCanonical,
    passwordHash,
  });

  return issueSession(user, input.userAgent ?? null, input.ipAddress ?? null);
}

export async function loginUser(input: LoginInput): Promise<SessionIssued> {
  const emailCanonical = normalizeEmail(input.email);
  const user = await findUserByEmailCanonical(emailCanonical);
  if (user === undefined || user.status !== 'active') {
    throw new AuthError(
      ErrorCodes.UNAUTHENTICATED,
      401,
      'Invalid email or password',
    );
  }
  const ok = await verifyPassword(user.passwordHash, input.password);
  if (!ok) {
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
